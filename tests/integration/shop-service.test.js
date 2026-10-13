import { afterAll, describe, expect, it } from "vitest";
import { createCleanup, hasTestDb, prisma, uniqueShopDomain } from "../helpers/db.js";
import { getOrCreateShop } from "../../app/services/shop.server.js";
import { markShopUninstalled } from "../../app/repositories/shop.server.js";

describe.skipIf(!hasTestDb)("getOrCreateShop", () => {
  const cleanup = createCleanup();

  afterAll(async () => {
    await cleanup.run();
  });

  it("creates the shop on first call and returns the same row afterwards", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    const first = await getOrCreateShop({ shop });
    const second = await getOrCreateShop({ shop });

    expect(first).toMatchObject({ shopDomain: shop, plan: "free", uninstalledAt: null });
    expect(second.id).toBe(first.id);
  });

  it("is safe under concurrent calls (one row)", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    const rows = await Promise.all(Array.from({ length: 5 }, () => getOrCreateShop({ shop })));

    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect(await prisma.shop.count({ where: { shopDomain: shop } })).toBe(1);
  });

  it("clears uninstalledAt and resets installedAt on reinstall", async () => {
    const shop = cleanup.shop(uniqueShopDomain());
    const original = await getOrCreateShop({ shop });
    expect(await markShopUninstalled(shop)).toBe(true);
    expect((await prisma.shop.findUnique({ where: { shopDomain: shop } })).uninstalledAt).not.toBeNull();

    const reinstalled = await getOrCreateShop({ shop });
    expect(reinstalled.id).toBe(original.id);
    expect(reinstalled.uninstalledAt).toBeNull();
    expect(reinstalled.installedAt.getTime()).toBeGreaterThanOrEqual(original.installedAt.getTime());
  });

  it("rejects a missing or malformed shop domain", async () => {
    await expect(getOrCreateShop(null)).rejects.toThrow();
    await expect(getOrCreateShop({ shop: "evil.com" })).rejects.toThrow();
  });
});
