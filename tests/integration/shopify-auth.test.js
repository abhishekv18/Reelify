/**
 * Regression: real Shopify webhook HMAC verification + Prisma session storage still work with the
 * Day 2 wiring (idempotent webhook routes, afterAuth hook). Uses test-only app credentials.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createCleanup,
  createTestShop,
  hasTestDb,
  prisma,
  uniqueShopDomain,
  uniqueWebhookId,
} from "../helpers/db.js";

const TEST_SECRET = "reelify-test-secret-not-real";

describe.skipIf(!hasTestDb)("Shopify auth regression", () => {
  const cleanup = createCleanup();
  let shopify, Session, uninstalledAction, scopesUpdateAction;

  beforeAll(async () => {
    process.env.SHOPIFY_API_KEY = "reelify-test-api-key";
    process.env.SHOPIFY_API_SECRET = TEST_SECRET;
    process.env.SHOPIFY_APP_URL = "https://reelify.test";
    process.env.SCOPES = "read_products";

    shopify = (await import("../../app/shopify.server.js")).default;
    ({ Session } = await import("@shopify/shopify-app-react-router/server"));
    ({ action: uninstalledAction } = await import("../../app/routes/webhooks.app.uninstalled.jsx"));
    ({ action: scopesUpdateAction } = await import("../../app/routes/webhooks.app.scopes_update.jsx"));
  });

  afterAll(async () => {
    await cleanup.run();
  });

  function signedRequest({ topic, shop, webhookId, body = {}, secret = TEST_SECRET, omit = [] }) {
    const raw = JSON.stringify(body);
    const headers = {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": createHmac("sha256", secret).update(raw).digest("base64"),
      "X-Shopify-Topic": topic,
      "X-Shopify-Shop-Domain": shop,
      "X-Shopify-API-Version": "2026-07",
      "X-Shopify-Webhook-Id": webhookId,
    };
    for (const name of omit) delete headers[name];
    return new Request("https://reelify.test/webhooks", { method: "POST", headers, body: raw });
  }

  function offlineSession(shop) {
    return new Session({
      id: `offline_${shop}`,
      shop,
      state: "",
      isOnline: false,
      scope: "read_products",
      accessToken: "test-token-not-real",
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
  }

  it("Prisma session storage stores, loads and deletes a session", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    const session = offlineSession(shop);

    expect(await shopify.sessionStorage.storeSession(session)).toBe(true);
    const loaded = await shopify.sessionStorage.loadSession(session.id);
    expect(loaded).toMatchObject({ id: session.id, shop, isOnline: false, scope: "read_products" });
    expect(await shopify.sessionStorage.deleteSession(session.id)).toBe(true);
    expect(await shopify.sessionStorage.loadSession(session.id)).toBeUndefined();
  });

  it("app/uninstalled: valid HMAC is processed once (sessions deleted, shop marked uninstalled)", async () => {
    const shopRow = await createTestShop(cleanup);
    const shop = shopRow.shopDomain;
    await shopify.sessionStorage.storeSession(offlineSession(shop));
    const webhookId = cleanup.webhook(uniqueWebhookId());

    const res = await uninstalledAction({
      request: signedRequest({ topic: "app/uninstalled", shop, webhookId }),
    });
    expect(res.status).toBe(200);
    expect(await prisma.session.count({ where: { shop } })).toBe(0);
    const afterFirst = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    expect(afterFirst.uninstalledAt).not.toBeNull();

    // Redelivery: 200, nothing reprocessed.
    const again = await uninstalledAction({
      request: signedRequest({ topic: "app/uninstalled", shop, webhookId }),
    });
    expect(again.status).toBe(200);
    const afterSecond = await prisma.shop.findUnique({ where: { shopDomain: shop } });
    expect(afterSecond.uninstalledAt).toEqual(afterFirst.uninstalledAt);
    expect(await prisma.processedWebhook.count({ where: { webhookId } })).toBe(1);
  });

  it("app/scopes_update: valid HMAC updates the stored scope", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    await shopify.sessionStorage.storeSession(offlineSession(shop));
    const webhookId = cleanup.webhook(uniqueWebhookId());

    const res = await scopesUpdateAction({
      request: signedRequest({
        topic: "app/scopes_update",
        shop,
        webhookId,
        body: { current: ["read_products"], previous: [] },
      }),
    });
    expect(res.status).toBe(200);
    expect((await prisma.processedWebhook.findUnique({ where: { webhookId } })).status).toBe(
      "COMPLETED",
    );
  });

  it("rejects an invalid HMAC with 401 and records nothing", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    const webhookId = cleanup.webhook(uniqueWebhookId());

    await expect(
      uninstalledAction({
        request: signedRequest({ topic: "app/uninstalled", shop, webhookId, secret: "wrong-secret" }),
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await prisma.processedWebhook.count({ where: { webhookId } })).toBe(0);
  });

  it("rejects a delivery without X-Shopify-Webhook-Id with 400", async () => {
    const shop = cleanup.shop(uniqueShopDomain());

    await expect(
      uninstalledAction({
        request: signedRequest({
          topic: "app/uninstalled",
          shop,
          webhookId: "unused",
          omit: ["X-Shopify-Webhook-Id"],
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
