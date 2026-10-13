/**
 * Video repository. Every function is scoped by shopId (first argument).
 */
import prisma from "../db.server.js";
import { pick } from "../lib/object.js";

const WRITABLE_FIELDS = /** @type {const} */ ([
  "status",
  "source",
  "externalId",
  "title",
  "caption",
  "originalKey",
  "videoKey",
  "previewKey",
  "posterKey",
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

const MAX_PAGE_SIZE = 100;

/**
 * @param {string} shopId
 * @param {Record<string, unknown>} data
 */
export function createVideo(shopId, data) {
  return prisma.video.create({ data: { ...pick(data, WRITABLE_FIELDS), shopId } });
}

/**
 * @param {string} shopId
 * @param {string} id
 */
export function getVideo(shopId, id) {
  return prisma.video.findFirst({ where: { id, shopId } });
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
 * Returns the updated video, or null when it does not exist for this shop.
 * @param {string} shopId
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export async function updateVideo(shopId, id, data) {
  const { count } = await prisma.video.updateMany({
    where: { id, shopId },
    data: pick(data, WRITABLE_FIELDS),
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
