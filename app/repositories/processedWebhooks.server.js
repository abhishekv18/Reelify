/**
 * Webhook idempotency records. System table keyed by the Shopify webhook id (documented exception to
 * "shopId first": deliveries are deduplicated before, and independently of, any shop lookup, and the
 * records must survive shop/redact).
 *
 * Claim protocol (no long-held transactions, safe through the Neon pooler):
 *   claim   → INSERT a PROCESSING row with a random claimToken (unique webhookId makes it atomic)
 *   complete→ PROCESSING → COMPLETED, only by the claim owner
 *   release → delete the PROCESSING row, only by the claim owner (handler failed → Shopify retries)
 * A PROCESSING row older than `staleAfterMs` (crashed process) can be taken over atomically.
 */
import { randomUUID } from "node:crypto";
import prisma from "../db.server.js";

export const DEFAULT_STALE_AFTER_MS = 2 * 60 * 1000;

/**
 * @param {{ webhookId: string, topic: string, shopDomain: string }} delivery
 * @param {{ staleAfterMs?: number, now?: Date }} [options]
 * @returns {Promise<{ status: "claimed", claimToken: string } | { status: "duplicate" } | { status: "in_progress" }>}
 */
export async function claimWebhook(
  { webhookId, topic, shopDomain },
  { staleAfterMs = DEFAULT_STALE_AFTER_MS, now = new Date() } = {},
) {
  const claimToken = randomUUID();

  // Retry a few times in case the existing row is released between our INSERT and SELECT.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await prisma.processedWebhook.create({
        data: { webhookId, topic, shopDomain, status: "PROCESSING", claimToken, startedAt: now },
      });
      return { status: "claimed", claimToken };
    } catch (error) {
      if (error?.code !== "P2002") throw error;
    }

    const existing = await prisma.processedWebhook.findUnique({ where: { webhookId } });
    if (!existing) continue;
    if (existing.status === "COMPLETED") return { status: "duplicate" };

    const cutoff = new Date(now.getTime() - staleAfterMs);
    if (existing.startedAt > cutoff) return { status: "in_progress" };

    // Stale claim: take it over only if nobody else did first.
    const { count } = await prisma.processedWebhook.updateMany({
      where: { webhookId, status: "PROCESSING", startedAt: { lt: cutoff } },
      data: { claimToken, startedAt: now },
    });
    return count === 1 ? { status: "claimed", claimToken } : { status: "in_progress" };
  }
  return { status: "in_progress" };
}

/**
 * Marks the delivery as successfully processed. Returns false if the claim was lost.
 * @param {string} webhookId
 * @param {string} claimToken
 */
export async function completeWebhook(webhookId, claimToken) {
  const { count } = await prisma.processedWebhook.updateMany({
    where: { webhookId, claimToken, status: "PROCESSING" },
    data: { status: "COMPLETED", processedAt: new Date(), claimToken: null },
  });
  return count === 1;
}

/**
 * Drops our claim after a failed handler so a redelivery can retry. Never touches COMPLETED rows
 * or another process's claim.
 * @param {string} webhookId
 * @param {string} claimToken
 */
export async function releaseWebhook(webhookId, claimToken) {
  const { count } = await prisma.processedWebhook.deleteMany({
    where: { webhookId, claimToken, status: "PROCESSING" },
  });
  return count === 1;
}

/**
 * @param {string} webhookId
 */
export function getProcessedWebhook(webhookId) {
  return prisma.processedWebhook.findUnique({ where: { webhookId } });
}

/**
 * Deletes records older than `olderThanDays` (completed by processedAt, abandoned claims by startedAt).
 * @param {{ olderThanDays?: number, now?: Date }} [options]
 * @returns {Promise<number>} rows deleted
 */
export async function pruneProcessedWebhooks({ olderThanDays = 30, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);
  const { count } = await prisma.processedWebhook.deleteMany({
    where: {
      OR: [
        { status: "COMPLETED", processedAt: { lt: cutoff } },
        { status: "PROCESSING", startedAt: { lt: cutoff } },
      ],
    },
  });
  return count;
}
