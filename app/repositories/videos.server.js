/**
 * Video repository. Every function is scoped by shopId (first argument), except getVideoByStreamUid
 * (documented system lookup for the Stream webhook/reconciler path, CLAUDE.md §6).
 */
import prisma from "../db.server.js";
import { PlanLimitError } from "../lib/errors.js";
import { pick } from "../lib/object.js";

/** Fields accepted when a row is created (initial state). */
const CREATE_FIELDS = /** @type {const} */ ([
  "status",
  "source",
  "externalId",
  "title",
  "caption",
  "mimeType",
  "sizeBytes",
  "width",
  "height",
  "durationMs",
  "errorCode",
  "errorMessage",
  "attempts",
  "rightsConfirmedAt",
]);

/** Merchant-editable fields. Status and Stream fields only change through transitionVideoStatus. */
const EDITABLE_FIELDS = /** @type {const} */ (["title", "caption"]);

/** Fields a status transition may write (values come from the Stream API, never from the client). */
const TRANSITION_FIELDS = /** @type {const} */ ([
  "status",
  "errorCode",
  "errorMessage",
  "sizeBytes",
  "width",
  "height",
  "durationMs",
  "streamState",
  "streamSyncedAt",
]);

const MAX_PAGE_SIZE = 100;

/**
 * Concurrent uploads for one shop queue on the advisory lock. Allow for that (and for remote-database
 * latency) instead of Prisma's 2 s / 5 s defaults; callers map a timeout (P2028) to a retryable error.
 */
const UPLOAD_TX_OPTIONS = Object.freeze({ maxWait: 10_000, timeout: 15_000 });

/**
 * @param {string} shopId
 * @param {Record<string, unknown>} data
 */
export function createVideo(shopId, data) {
  return prisma.video.create({ data: { ...pick(data, CREATE_FIELDS), shopId } });
}

/**
 * @param {string} shopId
 * @param {string} id
 */
export function getVideo(shopId, id) {
  return prisma.video.findFirst({ where: { id, shopId } });
}

/**
 * System lookup by Stream uid (webhook/reconciler only). Callers must run the ownership check
 * (uid, creator, meta.videoId) before changing anything.
 * @param {string} streamUid
 */
export function getVideoByStreamUid(streamUid) {
  return prisma.video.findUnique({ where: { streamUid } });
}

/**
 * Newest first, cursor pagination.
 * @param {string} shopId
 * @param {{ status?: string, source?: string, take?: number, cursor?: string }} [options]
 * @returns {Promise<{ items: any[], nextCursor: string | null }>}
 */
export async function listVideos(shopId, { status, source, take = 24, cursor } = {}) {
  const limit = Math.min(Math.max(Number(take) || 24, 1), MAX_PAGE_SIZE);

  // A cursor must point at one of this shop's videos; anything else is treated as "no more results".
  if (cursor && !(await getVideo(shopId, cursor))) {
    return { items: [], nextCursor: null };
  }

  const rows = await prisma.video.findMany({
    where: { shopId, ...(status ? { status } : {}), ...(source ? { source } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}

/**
 * Updates merchant-editable fields. Returns the updated video, or null when it does not exist for this shop.
 * @param {string} shopId
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export async function updateVideo(shopId, id, data) {
  const { count } = await prisma.video.updateMany({
    where: { id, shopId },
    data: pick(data, EDITABLE_FIELDS),
  });
  return count > 0 ? getVideo(shopId, id) : null;
}

/**
 * Deletes the video (tags and widget links cascade). Returns true if a row was deleted.
 * @param {string} shopId
 * @param {string} id
 */
export async function deleteVideo(shopId, id) {
  const { count } = await prisma.video.deleteMany({ where: { id, shopId } });
  return count > 0;
}

/**
 * Creates an UPLOAD_PENDING row after checking plan limits. Runs in one short transaction holding a
 * per-shop advisory lock, so concurrent requests cannot both slip under a limit.
 * Throws PlanLimitError (code VIDEO_LIMIT | MINUTES_LIMIT | PENDING_LIMIT).
 * @param {string} shopId
 * @param {{ title: string, mimeType: string, sizeBytes: number, rightsConfirmedAt: Date }} data
 * @param {{ maxVideos: number | null, maxStoredSeconds: number | null, maxPendingUploads: number, reservedSeconds: number }} limits
 */
export function createPendingUpload(shopId, data, limits) {
  return prisma.$transaction(async (tx) => {
    // 1) Transaction-scoped lock: released automatically on commit/rollback (works through the Neon pooler).
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`reelify:upload:${shopId}`}))) AS l`;

    // 2) Usage in ONE statement, issued after the lock so it sees rows committed by the previous holder
    //    (READ COMMITTED takes a new snapshot per statement). Keep this a separate statement from the lock.
    const [usage] = await tx.$queryRaw`
      SELECT
        count(*) FILTER (WHERE "status" <> 'FAILED')                         AS "videoCount",
        count(*) FILTER (WHERE "status" = 'UPLOAD_PENDING')                  AS "pendingCount",
        coalesce(sum("durationMs") FILTER (WHERE "status" <> 'FAILED'), 0)   AS "durationMs",
        count(*) FILTER (WHERE "status" <> 'FAILED' AND "durationMs" IS NULL) AS "unknownDuration"
      FROM "Video" WHERE "shopId" = ${shopId}`;
    const videoCount = Number(usage.videoCount);
    const pendingCount = Number(usage.pendingCount);
    const unknownDuration = Number(usage.unknownDuration);
    const storedMs = Number(usage.durationMs);

    if (limits.maxVideos !== null && videoCount >= limits.maxVideos) {
      throw new PlanLimitError("VIDEO_LIMIT", "You've reached the video limit for your plan.");
    }
    if (pendingCount >= limits.maxPendingUploads) {
      throw new PlanLimitError("PENDING_LIMIT", "Too many uploads in progress. Wait for them to finish.");
    }
    if (limits.maxStoredSeconds !== null) {
      // Videos without a known duration (still uploading/processing) count as a full reservation.
      const usedSeconds =
        storedMs / 1000 + unknownDuration * limits.reservedSeconds;
      if (usedSeconds + limits.reservedSeconds > limits.maxStoredSeconds) {
        throw new PlanLimitError("MINUTES_LIMIT", "You've reached the video minutes for your plan.");
      }
    }

    return tx.video.create({
      data: {
        shopId,
        status: "UPLOAD_PENDING",
        source: "UPLOAD",
        title: data.title,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        rightsConfirmedAt: data.rightsConfirmedAt,
      },
    });
  }, UPLOAD_TX_OPTIONS);
}

/**
 * Stores the Stream uid of a freshly created direct upload. Only applies to this shop's pending row
 * that has no uid yet. Returns true when the row was updated.
 * @param {string} shopId
 * @param {string} id
 * @param {{ streamUid: string, uploadExpiresAt: Date }} stream
 */
export async function attachStreamUpload(shopId, id, { streamUid, uploadExpiresAt }) {
  const { count } = await prisma.video.updateMany({
    where: { id, shopId, status: "UPLOAD_PENDING", streamUid: null },
    data: { streamUid, uploadExpiresAt, streamState: "pendingupload" },
  });
  return count === 1;
}

/**
 * Forward-only status transition: updates only if the current status is in `allowedFrom`.
 * Returns true when this call changed the row.
 * @param {string} shopId
 * @param {string} id
 * @param {string[]} allowedFrom
 * @param {Record<string, unknown>} data must include `status`
 */
export async function transitionVideoStatus(shopId, id, allowedFrom, data) {
  if (!allowedFrom.length) return false;
  const { count } = await prisma.video.updateMany({
    where: { id, shopId, status: { in: allowedFrom } },
    data: pick(data, TRANSITION_FIELDS),
  });
  return count === 1;
}
