import { upsertShopForInstall } from "../repositories/shop.server.js";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/**
 * Returns the Shop row for an authenticated Shopify session, creating it on first install and
 * clearing `uninstalledAt` on reinstall. Safe to call on every request and concurrently.
 * @param {{ shop?: string } | null | undefined} session verified session from authenticate.admin / afterAuth
 */
export async function getOrCreateShop(session) {
  const shopDomain = session?.shop;
  if (typeof shopDomain !== "string" || !SHOP_DOMAIN.test(shopDomain)) {
    throw new Error("getOrCreateShop requires a session with a valid shop domain.");
  }
  return upsertShopForInstall(shopDomain);
}
