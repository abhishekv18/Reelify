/**
 * Upload flow (CLAUDE.md §7, docs/STREAM.md §4):
 *   createUpload  → validate, plan limits, UPLOAD_PENDING row, Stream direct upload (one-time URL)
 *   completeUpload → browser hint after its upload; the server re-reads Stream and syncs
 * The one-time uploadURL is returned to the authenticated admin only and is never logged.
 */
import { PlanLimitError } from "../lib/errors.js";
import { TERMINAL_STATUSES } from "../lib/streamStatus.js";
import { MAX_DURATION_SECONDS, UPLOAD_URL_TTL_MS, validateUploadRequest } from "../lib/uploads.js";
import {
  attachStreamUpload,
  createPendingUpload,
  deleteVideo,
  getVideo,
} from "../repositories/videos.server.js";
import { getPlanLimits } from "./plan.server.js";
import { getStreamClient, StreamApiError, StreamConfigError } from "./stream.server.js";
import { syncVideoFromStream } from "./videoSync.server.js";

/** An expected, user-facing failure with an HTTP status and a machine-readable code. */
export class UploadError extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message plain language, safe to show to the merchant
   */
  constructor(status, code, message) {
    super(message);
    this.name = "UploadError";
    this.status = status;
    this.code = code;
  }
}

/** Public shape of a video's upload state (no internal fields). */
export function toUploadStatus(video) {
  return {
    videoId: video.id,
    status: video.status,
    errorCode: video.errorCode ?? null,
    errorMessage: video.errorMessage ?? null,
  };
}

/** @param {ReturnType<typeof getStreamClient> | undefined} stream */
function resolveStream(stream) {
  if (stream) return stream;
  try {
    return getStreamClient();
  } catch (error) {
    if (error instanceof StreamConfigError) {
      throw new UploadError(503, "UPLOADS_UNAVAILABLE", "Video uploads aren't available right now.");
    }
    throw error;
  }
}

/**
 * @param {{ id: string, plan?: string }} shop resolved from the authenticated session
 * @param {unknown} body parsed JSON from the admin
 * @param {{ stream?: ReturnType<typeof getStreamClient>, now?: Date, logger?: Pick<Console, "error"> }} [deps]
 * @returns {Promise<{ videoId: string, uploadURL: string, expiresAt: string }>}
 */
export async function createUpload(shop, body, { stream, now = new Date(), logger = console } = {}) {
  const parsed = validateUploadRequest(body);
  if (!parsed.ok) throw new UploadError(400, parsed.code, parsed.message);
  const client = resolveStream(stream);

  let video;
  try {
    video = await createPendingUpload(
      shop.id,
      {
        title: parsed.value.title,
        mimeType: parsed.value.contentType,
        sizeBytes: parsed.value.sizeBytes,
        rightsConfirmedAt: now,
      },
      getPlanLimits(shop),
    );
  } catch (error) {
    if (error instanceof PlanLimitError) throw new UploadError(403, error.code, error.message);
    // P2028: the transaction could not start/finish in time (many parallel uploads for this shop).
    if (error?.code === "P2028") {
      throw new UploadError(503, "UPLOAD_BUSY", "Too many uploads are starting at once. Try again in a moment.");
    }
    throw error;
  }

  const expiresAt = new Date(now.getTime() + UPLOAD_URL_TTL_MS);
  let upload;
  try {
    upload = await client.createDirectUpload({
      maxDurationSeconds: MAX_DURATION_SECONDS,
      expiry: expiresAt,
      requireSignedURLs: true,
      creator: shop.id,
      meta: { app: "reelify", shopId: shop.id, videoId: video.id, name: parsed.value.title },
    });
  } catch (error) {
    await deleteVideo(shop.id, video.id);
    if (error instanceof StreamApiError) {
      logger.error("Stream direct upload failed", {
        shopId: shop.id,
        videoId: video.id,
        status: error.status,
        codes: error.codes,
      });
      throw new UploadError(502, "STREAM_UNAVAILABLE", "We couldn't start the upload. Try again in a moment.");
    }
    throw error;
  }

  const attached = await attachStreamUpload(shop.id, video.id, { streamUid: upload.uid, uploadExpiresAt: expiresAt });
  if (!attached) {
    // The row disappeared (e.g. deleted concurrently): do not leave an orphan reservation in Stream.
    await client.deleteVideo(upload.uid).catch(() => {});
    throw new UploadError(409, "UPLOAD_CANCELLED", "This upload was cancelled.");
  }

  return { videoId: video.id, uploadURL: upload.uploadURL, expiresAt: expiresAt.toISOString() };
}

/**
 * @param {{ id: string }} shop resolved from the authenticated session
 * @param {string} videoId from the URL; looked up only within this shop
 * @param {{ stream?: ReturnType<typeof getStreamClient>, now?: Date, logger?: Pick<Console, "warn" | "error"> }} [deps]
 */
export async function completeUpload(shop, videoId, { stream, now = new Date(), logger = console } = {}) {
  if (typeof videoId !== "string" || videoId.length === 0 || videoId.length > 64) {
    throw new UploadError(404, "NOT_FOUND", "Video not found.");
  }
  const video = await getVideo(shop.id, videoId);
  if (!video) throw new UploadError(404, "NOT_FOUND", "Video not found.");
  if (TERMINAL_STATUSES.includes(video.status)) return toUploadStatus(video);
  if (!video.streamUid) throw new UploadError(409, "UPLOAD_NOT_STARTED", "This upload hasn't started.");

  let result;
  try {
    result = await syncVideoFromStream(video, { stream: resolveStream(stream), now, logger });
  } catch (error) {
    if (error instanceof StreamApiError) {
      logger.error("Stream sync failed", { shopId: shop.id, videoId, status: error.status, codes: error.codes });
      throw new UploadError(502, "STREAM_UNAVAILABLE", "We couldn't check the upload. Try again in a moment.");
    }
    throw error;
  }

  if (result.outcome === "OWNERSHIP_MISMATCH") {
    throw new UploadError(409, "VERIFICATION_FAILED", "We couldn't verify this upload. Upload the video again.");
  }
  const latest = result.video ?? video;
  if (latest.status === "UPLOAD_PENDING") {
    throw new UploadError(409, "UPLOAD_NOT_RECEIVED", "The video hasn't finished uploading yet.");
  }
  return toUploadStatus(latest);
}
