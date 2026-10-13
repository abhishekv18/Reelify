/**
 * Shop repository. Shop is the tenant root, so these functions are the documented exception to
 * "shopId first": install/uninstall flows only know the shop domain (from a verified session or webhook).
 */
import prisma from "../db.server.js";

/**
 * Creates the shop on first install, or reactivates it on reinstall. Idempotent and race-safe:
 * `upsert` on the unique `shopDomain` runs as a single INSERT … ON CONFLICT on PostgreSQL.
 * @param {string} shopDomain verified *.myshopify.com domain
 */
export async function upsertShopForInstall(shopDomain) {
  const now = new Date();
  // Reinstall: clear uninstalledAt and restart installedAt only when the shop was uninstalled.
  await prisma.shop.updateMany({
    where: { shopDomain, uninstalledAt: { not: null } },
    data: { uninstalledAt: null, installedAt: now },
  });
  try {
    return await prisma.shop.upsert({
      where: { shopDomain },
      create: { shopDomain, installedAt: now },
      update: {},
    });
  } catch (error) {
    // Concurrent first install lost the race: the row now exists.
    if (error?.code === "P2002") {
      return prisma.shop.findUniqueOrThrow({ where: { shopDomain } });
    }
    throw error;
  }
}

/** @param {string} shopId */
export function getShop(shopId) {
  return prisma.shop.findUnique({ where: { id: shopId } });
}

/** @param {string} shopDomain */
export function getShopByDomain(shopDomain) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}

/**
 * Marks the shop as uninstalled (data is kept until shop/redact). Returns true if a row changed.
 * @param {string} shopDomain
 */
export async function markShopUninstalled(shopDomain) {
  const { count } = await prisma.shop.updateMany({
    where: { shopDomain, uninstalledAt: null },
    data: { uninstalledAt: new Date() },
  });
  return count > 0;
}

/**
 * Deletes the shop and, through cascades, every tenant row it owns (used by shop/redact).
 * @param {string} shopId
 */
export async function deleteShop(shopId) {
  const { count } = await prisma.shop.deleteMany({ where: { id: shopId } });
  return count > 0;
}
