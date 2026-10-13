/**
 * Product tags on videos. Every function is scoped by shopId (first argument).
 * The composite FK VideoProduct(shopId, videoId) → Video(shopId, id) also blocks cross-shop links in the DB.
 */
import prisma from "../db.server.js";
import { OwnershipError, ValidationError } from "../lib/errors.js";

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const MAX_TAGS_PER_VIDEO = 50;

/**
 * @param {unknown} products
 * @returns {{ productGid: string, handle: string }[]}
 */
function validateProducts(products) {
  if (!Array.isArray(products)) throw new ValidationError("products must be an array.");
  if (products.length > MAX_TAGS_PER_VIDEO) {
    throw new ValidationError(`A video can have at most ${MAX_TAGS_PER_VIDEO} products.`);
  }
  const seen = new Set();
  return products.map((p) => {
    const productGid = p?.productGid;
    const handle = p?.handle;
    if (typeof productGid !== "string" || !PRODUCT_GID.test(productGid)) {
      throw new ValidationError("Invalid product id.");
    }
    if (typeof handle !== "string" || handle.trim() === "") {
      throw new ValidationError("Invalid product handle.");
    }
    if (seen.has(productGid)) throw new ValidationError("Duplicate product.");
    seen.add(productGid);
    return { productGid, handle: handle.trim() };
  });
}

/**
 * @param {string} shopId
 * @param {string} videoId
 */
export function listVideoProducts(shopId, videoId) {
  return prisma.videoProduct.findMany({
    where: { shopId, videoId },
    orderBy: { position: "asc" },
  });
}

/**
 * Replaces the video's tagged products (order = array order).
 * Throws OwnershipError if the video is not this shop's.
 * @param {string} shopId
 * @param {string} videoId
 * @param {{ productGid: string, handle: string }[]} products
 */
export async function setVideoProducts(shopId, videoId, products) {
  const clean = validateProducts(products);
  return prisma.$transaction(async (tx) => {
    const video = await tx.video.findFirst({ where: { id: videoId, shopId }, select: { id: true } });
    if (!video) throw new OwnershipError("Video not found.");

    await tx.videoProduct.deleteMany({ where: { shopId, videoId } });
    if (clean.length) {
      await tx.videoProduct.createMany({
        data: clean.map((p, position) => ({ shopId, videoId, position, ...p })),
      });
    }
    return tx.videoProduct.findMany({ where: { shopId, videoId }, orderBy: { position: "asc" } });
  });
}

/**
 * Removes a product from all of this shop's videos (products/delete webhook). Returns rows removed.
 * @param {string} shopId
 * @param {string} productGid
 */
export async function deleteProductTags(shopId, productGid) {
  const { count } = await prisma.videoProduct.deleteMany({ where: { shopId, productGid } });
  return count;
}

/**
 * Updates the stored handle for a product (products/update webhook). Returns rows updated.
 * @param {string} shopId
 * @param {string} productGid
 * @param {string} handle
 */
export async function updateProductHandle(shopId, productGid, handle) {
  if (typeof handle !== "string" || handle.trim() === "") {
    throw new ValidationError("Invalid product handle.");
  }
  const { count } = await prisma.videoProduct.updateMany({
    where: { shopId, productGid },
    data: { handle: handle.trim() },
  });
  return count;
}
