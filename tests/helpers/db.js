/**
 * Integration-test helpers. Only used when tests/setup.js pointed Prisma at the test branch.
 * Cleanup deletes exactly the rows a test created (by id) — never unfiltered deletes.
 */
import { randomUUID } from "node:crypto";
import prisma from "../../app/db.server.js";

export { prisma };

export const hasTestDb = Boolean(process.env.REELIFY_TEST_DB);

export function uniqueShopDomain() {
  return `rl-test-${randomUUID().slice(0, 12)}.myshopify.com`;
}

export function uniqueWebhookId() {
  return `rl-test-${randomUUID()}`;
}

/** Tracks rows created by a test file and removes only those. */
export function createCleanup() {
  const shopDomains = new Set();
  const webhookIds = new Set();

  return {
    /** @param {string} domain */
    shop(domain) {
      shopDomains.add(domain);
      return domain;
    },
    /** @param {string} id */
    webhook(id) {
      webhookIds.add(id);
      return id;
    },
    async run() {
      const domains = [...shopDomains];
      const ids = [...webhookIds];
      if (domains.length) {
        // Tenant rows cascade from Shop.
        await prisma.shop.deleteMany({ where: { shopDomain: { in: domains } } });
        await prisma.session.deleteMany({ where: { shop: { in: domains } } });
        await prisma.processedWebhook.deleteMany({ where: { shopDomain: { in: domains } } });
      }
      if (ids.length) {
        await prisma.processedWebhook.deleteMany({ where: { webhookId: { in: ids } } });
      }
      shopDomains.clear();
      webhookIds.clear();
    },
  };
}

/**
 * Creates a Shop row with a unique test domain and registers it for cleanup.
 * @param {ReturnType<typeof createCleanup>} cleanup
 */
export function createTestShop(cleanup) {
  return prisma.shop.create({ data: { shopDomain: cleanup.shop(uniqueShopDomain()) } });
}
