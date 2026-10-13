/**
 * Widget placement rules. Every function is scoped by shopId (first argument).
 * Composite FK Placement(shopId, widgetId) → Widget(shopId, id) blocks cross-shop links in the DB too.
 */
import prisma from "../db.server.js";
import { OwnershipError, ValidationError } from "../lib/errors.js";

const TARGET_GID = {
  PRODUCT: /^gid:\/\/shopify\/Product\/\d+$/,
  COLLECTION: /^gid:\/\/shopify\/Collection\/\d+$/,
};
const PAGE_TYPES = new Set(["HOME", "ALL_PRODUCTS", "PRODUCT", "COLLECTION"]);
const MAX_PLACEMENTS_PER_WIDGET = 100;

/**
 * @param {unknown} placements
 * @returns {{ pageType: string, targetGid: string | null }[]}
 */
function validatePlacements(placements) {
  if (!Array.isArray(placements)) throw new ValidationError("placements must be an array.");
  if (placements.length > MAX_PLACEMENTS_PER_WIDGET) {
    throw new ValidationError("Too many placements.");
  }
  const seen = new Set();
  return placements.map((p) => {
    const pageType = p?.pageType;
    if (!PAGE_TYPES.has(pageType)) throw new ValidationError("Invalid page type.");

    const pattern = TARGET_GID[pageType];
    const targetGid = p?.targetGid ?? null;
    if (pattern ? !(typeof targetGid === "string" && pattern.test(targetGid)) : targetGid !== null) {
      throw new ValidationError(`Invalid target for ${pageType}.`);
    }

    const key = `${pageType}:${targetGid}`;
    if (seen.has(key)) throw new ValidationError("Duplicate placement.");
    seen.add(key);
    return { pageType, targetGid };
  });
}

/**
 * @param {string} shopId
 * @param {string} widgetId
 */
export function listPlacements(shopId, widgetId) {
  return prisma.placement.findMany({
    where: { shopId, widgetId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/**
 * Replaces the widget's placements. Throws OwnershipError if the widget is not this shop's.
 * @param {string} shopId
 * @param {string} widgetId
 * @param {{ pageType: string, targetGid?: string | null }[]} placements
 */
export async function setPlacements(shopId, widgetId, placements) {
  const clean = validatePlacements(placements);
  return prisma.$transaction(async (tx) => {
    const widget = await tx.widget.findFirst({ where: { id: widgetId, shopId }, select: { id: true } });
    if (!widget) throw new OwnershipError("Widget not found.");

    await tx.placement.deleteMany({ where: { shopId, widgetId } });
    if (clean.length) {
      await tx.placement.createMany({
        data: clean.map((p) => ({ shopId, widgetId, ...p })),
      });
    }
    return tx.placement.findMany({
      where: { shopId, widgetId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  });
}
