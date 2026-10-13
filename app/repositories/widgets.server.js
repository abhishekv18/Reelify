/**
 * Widget (playlist) repository, including the widget ↔ video links.
 * Every function is scoped by shopId (first argument). Composite FKs on WidgetVideo
 * ((shopId, widgetId) → Widget, (shopId, videoId) → Video) block cross-shop links in the DB too.
 */
import prisma from "../db.server.js";
import { OwnershipError, ValidationError } from "../lib/errors.js";
import { pick } from "../lib/object.js";

const WRITABLE_FIELDS = /** @type {const} */ (["name", "type", "isActive", "settings"]);
const MAX_VIDEOS_PER_WIDGET = 100;

/**
 * @param {string} shopId
 * @param {Record<string, unknown>} data
 */
export function createWidget(shopId, data) {
  return prisma.widget.create({ data: { ...pick(data, WRITABLE_FIELDS), shopId } });
}

/**
 * @param {string} shopId
 * @param {string} id
 */
export function getWidget(shopId, id) {
  return prisma.widget.findFirst({ where: { id, shopId } });
}

/** @param {string} shopId */
export function listWidgets(shopId) {
  return prisma.widget.findMany({
    where: { shopId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/**
 * Returns the updated widget, or null when it does not exist for this shop.
 * @param {string} shopId
 * @param {string} id
 * @param {Record<string, unknown>} data
 */
export async function updateWidget(shopId, id, data) {
  const { count } = await prisma.widget.updateMany({
    where: { id, shopId },
    data: pick(data, WRITABLE_FIELDS),
  });
  return count > 0 ? getWidget(shopId, id) : null;
}

/**
 * Deletes the widget (video links and placements cascade). Returns true if a row was deleted.
 * @param {string} shopId
 * @param {string} id
 */
export async function deleteWidget(shopId, id) {
  const { count } = await prisma.widget.deleteMany({ where: { id, shopId } });
  return count > 0;
}

/**
 * @param {string} shopId
 * @param {string} widgetId
 */
export function listWidgetVideos(shopId, widgetId) {
  return prisma.widgetVideo.findMany({
    where: { shopId, widgetId },
    orderBy: { position: "asc" },
  });
}

/**
 * Replaces the widget's videos (order = array order). Throws OwnershipError if the widget or
 * any video does not belong to this shop.
 * @param {string} shopId
 * @param {string} widgetId
 * @param {string[]} videoIds
 */
export async function setWidgetVideos(shopId, widgetId, videoIds) {
  if (!Array.isArray(videoIds) || videoIds.some((id) => typeof id !== "string" || !id)) {
    throw new ValidationError("videoIds must be an array of ids.");
  }
  if (new Set(videoIds).size !== videoIds.length) throw new ValidationError("Duplicate video.");
  if (videoIds.length > MAX_VIDEOS_PER_WIDGET) {
    throw new ValidationError(`A widget can have at most ${MAX_VIDEOS_PER_WIDGET} videos.`);
  }

  return prisma.$transaction(async (tx) => {
    const widget = await tx.widget.findFirst({ where: { id: widgetId, shopId }, select: { id: true } });
    if (!widget) throw new OwnershipError("Widget not found.");

    const owned = await tx.video.count({ where: { shopId, id: { in: videoIds } } });
    if (owned !== videoIds.length) throw new OwnershipError("Video not found.");

    await tx.widgetVideo.deleteMany({ where: { shopId, widgetId } });
    if (videoIds.length) {
      await tx.widgetVideo.createMany({
        data: videoIds.map((videoId, position) => ({ shopId, widgetId, videoId, position })),
      });
    }
    return tx.widgetVideo.findMany({ where: { shopId, widgetId }, orderBy: { position: "asc" } });
  });
}
