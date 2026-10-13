/**
 * Webhook idempotency.
 *
 *   export const action = ({ request }) =>
 *     withIdempotency(request, "app/uninstalled", async ({ shop, session, payload }) => { ... });
 *
 * 1. authenticate.webhook(request) verifies HMAC and headers (401 / 400 / 405 Responses propagate).
 * 2. The X-Shopify-Webhook-Id is claimed in ProcessedWebhook (see repositories/processedWebhooks.server.js).
 * 3. Already COMPLETED → 200 without running the handler. Another delivery in flight → 409 (Shopify retries).
 * 4. Handler success → COMPLETED → 200. Handler failure → claim released → 500 (Shopify retries).
 */
import {
  claimWebhook,
  completeWebhook,
  releaseWebhook,
} from "../repositories/processedWebhooks.server.js";

/** Same normalization shopify-api applies to the X-Shopify-Topic header ("app/uninstalled" → "APP_UNINSTALLED"). */
export function normalizeTopic(topic) {
  return String(topic).toUpperCase().replace(/\/|\./g, "_");
}

/**
 * @typedef {object} IdempotencyDeps
 * @property {(request: Request) => Promise<any>} authenticate  e.g. shopify authenticate.webhook
 * @property {typeof claimWebhook} [claim]
 * @property {typeof completeWebhook} [complete]
 * @property {typeof releaseWebhook} [release]
 * @property {Pick<Console, "info" | "warn" | "error">} [logger]
 */

/**
 * @param {IdempotencyDeps} deps
 * @returns {(request: Request, topic: string, handler: (ctx: any) => Promise<Response | void> | Response | void) => Promise<Response>}
 */
export function createWithIdempotency({
  authenticate,
  claim = claimWebhook,
  complete = completeWebhook,
  release = releaseWebhook,
  logger = console,
}) {
  return async function withIdempotencyImpl(request, topic, handler) {
    // Throws a Response (401 invalid HMAC, 400 missing headers, 405 non-POST); let it propagate.
    const ctx = await authenticate(request);

    if (!ctx?.webhookId) {
      return new Response(undefined, { status: 400, statusText: "Missing webhook id" });
    }
    if (normalizeTopic(ctx.topic) !== normalizeTopic(topic)) {
      return new Response(undefined, { status: 400, statusText: "Unexpected topic" });
    }

    const log = { topic: ctx.topic, shop: ctx.shop, webhookId: ctx.webhookId };
    const result = await claim({
      webhookId: ctx.webhookId,
      topic: normalizeTopic(ctx.topic),
      shopDomain: ctx.shop,
    });

    if (result.status === "duplicate") {
      logger.info("Duplicate webhook ignored", log);
      return new Response(undefined, { status: 200 });
    }
    if (result.status === "in_progress") {
      logger.info("Webhook already in progress", log);
      return new Response(undefined, { status: 409 });
    }

    let response;
    try {
      response = await handler(ctx);
    } catch (error) {
      await release(ctx.webhookId, result.claimToken).catch(() => {});
      // Name/code only: error messages can contain payload data.
      logger.error("Webhook handler failed", { ...log, error: error?.name, code: error?.code });
      return new Response(undefined, { status: 500 });
    }

    if (!(await complete(ctx.webhookId, result.claimToken))) {
      logger.warn("Webhook claim was lost before completion", log);
    }
    return response instanceof Response ? response : new Response(undefined, { status: 200 });
  };
}

/**
 * Production helper bound to Shopify's authenticate.webhook (HMAC verification unchanged).
 * shopify.server is imported lazily so this module stays importable in tests without app config.
 * @param {Request} request
 * @param {string} topic e.g. "app/uninstalled"
 * @param {(ctx: any) => Promise<Response | void> | Response | void} handler
 */
export async function withIdempotency(request, topic, handler) {
  const { authenticate } = await import("../shopify.server.js");
  return createWithIdempotency({ authenticate: authenticate.webhook })(request, topic, handler);
}
