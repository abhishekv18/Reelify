/**
 * The single Stream → database sync path (CLAUDE.md §7). Used by /complete now, and by the Stream webhook
 * and the reconciler on Day 4. The Stream API response is the source of truth; callers never pass
 * client-supplied state.
 */
import { allowedFrom, ERROR_MESSAGES, mapStreamVideo, TERMINAL_STATUSES } from "../lib/streamStatus.js";
import { MAX_DURATION_SECONDS, MAX_UPLOAD_BYTES } from "../lib/uploads.js";
import { getVideo, transitionVideoStatus } from "../repositories/videos.server.js";
import { getStreamClient } from "./stream.server.js";

/**
 * @typedef {"UPDATED" | "UNCHANGED" | "NOT_FOUND" | "OWNERSHIP_MISMATCH" | "NO_STREAM_UID"} SyncOutcome
 */

/** @param {number | undefined} value */
const positive = (value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null);

/**
 * Does the Stream video belong to this row? (uid, creator = shopId, meta.videoId = row id)
 * @param {{ id: string, shopId: string, streamUid: string | null }} video
 * @param {any} details
 */
export function isOwnedStreamVideo(video, details) {
  return (
    details?.uid === video.streamUid &&
    details?.creator === video.shopId &&
    details?.meta?.videoId === video.id
  );
}

/**
 * @param {{ id: string, shopId: string, streamUid: string | null, status: string }} video row loaded by (id, shopId) or by streamUid
 * @param {{ stream?: ReturnType<typeof getStreamClient>, details?: any, logger?: Pick<Console, "warn" | "error">, now?: Date }} [options]
 *   `details` lets a caller pass an already-fetched GET /stream/{uid} result (never a webhook payload).
 * @returns {Promise<{ outcome: SyncOutcome, video: any }>}
 */
export async function syncVideoFromStream(video, { stream, details, logger = console, now = new Date() } = {}) {
  if (!video?.streamUid) return { outcome: "NO_STREAM_UID", video };
  const log = { videoId: video.id, shopId: video.shopId, uid: video.streamUid };
  const client = stream ?? getStreamClient();
  const current = details === undefined ? await client.getVideo(video.streamUid) : details;

  if (current === null) {
    // Unknown to Stream. A pending upload whose URL has not been used yet is left for the reconciler (Day 4);
    // anything further along has disappeared from Stream.
    if (video.status === "UPLOAD_PENDING" || TERMINAL_STATUSES.includes(video.status)) {
      return { outcome: "NOT_FOUND", video };
    }
    const changed = await transitionVideoStatus(video.shopId, video.id, allowedFrom("FAILED"), {
      status: "FAILED",
      errorCode: "SOURCE_UNAVAILABLE",
      errorMessage: ERROR_MESSAGES.SOURCE_UNAVAILABLE,
      streamState: null,
      streamSyncedAt: now,
    });
    return { outcome: changed ? "UPDATED" : "NOT_FOUND", video: await getVideo(video.shopId, video.id) };
  }

  if (!isOwnedStreamVideo(video, current)) {
    logger.error("Stream ownership check failed; video not changed", log);
    return { outcome: "OWNERSHIP_MISMATCH", video };
  }

  // Private by default (D10): repair a video that is somehow publicly playable.
  if (current.requireSignedURLs !== true) {
    logger.warn("Stream video did not require signed URLs; enabling", log);
    await client.updateVideo(video.streamUid, { requireSignedURLs: true });
  }

  const mapped = mapStreamVideo(current);
  const durationSeconds = positive(current.duration);
  const sizeBytes = positive(current.size);

  let target = mapped.status;
  let errorCode = mapped.errorCode ?? null;
  // Re-check D9 with the real values from Stream.
  if (target !== "FAILED" && durationSeconds !== null && durationSeconds > MAX_DURATION_SECONDS) {
    target = "FAILED";
    errorCode = "TOO_LONG";
  } else if (target !== "FAILED" && sizeBytes !== null && sizeBytes > MAX_UPLOAD_BYTES) {
    target = "FAILED";
    errorCode = "TOO_LARGE";
  }
  const deleteFromStream = target === "FAILED" && mapped.status !== "FAILED";

  const data = {
    status: target,
    errorCode,
    errorMessage: errorCode ? ERROR_MESSAGES[errorCode] : null,
    streamState: typeof current.status?.state === "string" ? current.status.state : null,
    streamSyncedAt: now,
    ...(durationSeconds !== null ? { durationMs: Math.round(durationSeconds * 1000) } : {}),
    ...(sizeBytes !== null ? { sizeBytes: Math.round(sizeBytes) } : {}),
    ...(positive(current.input?.width) !== null ? { width: Math.round(current.input.width) } : {}),
    ...(positive(current.input?.height) !== null ? { height: Math.round(current.input.height) } : {}),
  };

  const changed = await transitionVideoStatus(video.shopId, video.id, allowedFrom(target), data);

  if (changed && deleteFromStream) {
    // We rejected a video Stream accepted: remove it (best effort here; Day 4 adds a retried delete job).
    try {
      await client.deleteVideo(video.streamUid);
    } catch (error) {
      logger.error("Could not delete rejected Stream video", { ...log, error: error?.name, status: error?.status });
    }
  }

  return { outcome: changed ? "UPDATED" : "UNCHANGED", video: await getVideo(video.shopId, video.id) };
}
