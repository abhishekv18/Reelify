import { afterAll, describe, expect, it, vi } from "vitest";
import { createCleanup, hasTestDb, prisma, uniqueShopDomain, uniqueWebhookId } from "../helpers/db.js";
import { createWithIdempotency } from "../../app/services/webhooks.server.js";
import {
  claimWebhook,
  getProcessedWebhook,
  pruneProcessedWebhooks,
} from "../../app/repositories/processedWebhooks.server.js";

const silentLogger = { info() {}, warn() {}, error() {} };

/** Fake authenticate.webhook: the real HMAC path is covered in shopify-auth.test.js. */
function fakeAuth(ctx) {
  return async () => ({ topic: "APP_UNINSTALLED", payload: {}, ...ctx });
}

describe.skipIf(!hasTestDb)("withIdempotency", () => {
  const cleanup = createCleanup();
  const shop = cleanup.shop(uniqueShopDomain());

  afterAll(async () => {
    await cleanup.run();
  });

  function delivery() {
    const webhookId = cleanup.webhook(uniqueWebhookId());
    const withIdempotency = createWithIdempotency({
      authenticate: fakeAuth({ webhookId, shop }),
      logger: silentLogger,
    });
    const send = (handler) => withIdempotency(new Request("https://x.test"), "app/uninstalled", handler);
    return { webhookId, send };
  }

  it("processes once and ignores a redelivery", async () => {
    const { webhookId, send } = delivery();
    const handler = vi.fn(async () => {});

    expect((await send(handler)).status).toBe(200);
    expect((await send(handler)).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(await getProcessedWebhook(webhookId)).toMatchObject({
      status: "COMPLETED",
      topic: "APP_UNINSTALLED",
      shopDomain: shop,
      claimToken: null,
    });
  });

  it("runs the handler exactly once under 10 concurrent duplicate deliveries", async () => {
    const { send } = delivery();
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });

    const responses = await Promise.all(Array.from({ length: 10 }, () => send(handler)));

    expect(handler).toHaveBeenCalledTimes(1);
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
  });

  it("does not record a failed handler as completed and allows a retry", async () => {
    const { webhookId, send } = delivery();
    const failing = vi.fn(async () => {
      throw new Error("boom");
    });

    expect((await send(failing)).status).toBe(500);
    expect(await getProcessedWebhook(webhookId)).toBeNull();

    const succeeding = vi.fn(async () => {});
    expect((await send(succeeding)).status).toBe(200);
    expect(succeeding).toHaveBeenCalledTimes(1);
    expect((await getProcessedWebhook(webhookId)).status).toBe("COMPLETED");
  });

  it("takes over a stale in-flight claim but not a fresh one", async () => {
    const webhookId = cleanup.webhook(uniqueWebhookId());
    const d = { webhookId, topic: "APP_UNINSTALLED", shopDomain: shop };
    const old = new Date(Date.now() - 10 * 60 * 1000);

    expect((await claimWebhook(d, { now: old })).status).toBe("claimed");
    expect((await claimWebhook(d, { now: new Date(old.getTime() + 1000) })).status).toBe(
      "in_progress",
    );
    expect((await claimWebhook(d)).status).toBe("claimed");
  });

  it("rejects an unexpected topic or missing webhook id without running the handler", async () => {
    const handler = vi.fn();
    const wrongTopic = createWithIdempotency({
      authenticate: fakeAuth({ webhookId: uniqueWebhookId(), shop, topic: "APP_SCOPES_UPDATE" }),
      logger: silentLogger,
    });
    const noId = createWithIdempotency({
      authenticate: fakeAuth({ webhookId: undefined, shop }),
      logger: silentLogger,
    });

    expect((await wrongTopic(new Request("https://x.test"), "app/uninstalled", handler)).status).toBe(400);
    expect((await noId(new Request("https://x.test"), "app/uninstalled", handler)).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("propagates authentication failures (e.g. invalid HMAC → 401)", async () => {
    const withIdempotency = createWithIdempotency({
      authenticate: async () => {
        throw new Response(undefined, { status: 401 });
      },
      logger: silentLogger,
    });
    const handler = vi.fn();
    await expect(
      withIdempotency(new Request("https://x.test"), "app/uninstalled", handler),
    ).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it("prunes only records older than 30 days", async () => {
    const oldId = cleanup.webhook(uniqueWebhookId());
    const newId = cleanup.webhook(uniqueWebhookId());
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await prisma.processedWebhook.createMany({
      data: [
        { webhookId: oldId, topic: "T", shopDomain: shop, status: "COMPLETED", startedAt: longAgo, processedAt: longAgo },
        { webhookId: newId, topic: "T", shopDomain: shop, status: "COMPLETED", processedAt: new Date() },
      ],
    });

    await pruneProcessedWebhooks();

    expect(await getProcessedWebhook(oldId)).toBeNull();
    expect(await getProcessedWebhook(newId)).not.toBeNull();
  });
});
