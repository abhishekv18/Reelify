import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCleanup, createTestShop, hasTestDb, prisma } from "../helpers/db.js";
import {
  createVideo,
  deleteVideo,
  getVideo,
  listVideos,
  updateVideo,
} from "../../app/repositories/videos.server.js";
import {
  deleteProductTags,
  listVideoProducts,
  setVideoProducts,
  updateProductHandle,
} from "../../app/repositories/videoProducts.server.js";
import {
  createWidget,
  deleteWidget,
  getWidget,
  listWidgetVideos,
  listWidgets,
  setWidgetVideos,
  updateWidget,
} from "../../app/repositories/widgets.server.js";
import { listPlacements, setPlacements } from "../../app/repositories/placements.server.js";
import { deleteShop } from "../../app/repositories/shop.server.js";
import { OwnershipError, ValidationError } from "../../app/lib/errors.js";

const PRODUCT = "gid://shopify/Product/1001";

describe.skipIf(!hasTestDb)("tenant isolation (repositories)", () => {
  const cleanup = createCleanup();
  let shopA, shopB, videoA, videoB, widgetA, widgetB;

  beforeAll(async () => {
    shopA = await createTestShop(cleanup);
    shopB = await createTestShop(cleanup);

    videoA = await createVideo(shopA.id, { title: "A video", status: "READY" });
    videoB = await createVideo(shopB.id, { title: "B video", status: "READY" });
    widgetA = await createWidget(shopA.id, { name: "A widget", type: "CAROUSEL" });
    widgetB = await createWidget(shopB.id, { name: "B widget", type: "CAROUSEL" });

    await setVideoProducts(shopB.id, videoB.id, [{ productGid: PRODUCT, handle: "b-product" }]);
    await setWidgetVideos(shopB.id, widgetB.id, [videoB.id]);
    await setPlacements(shopB.id, widgetB.id, [{ pageType: "HOME" }]);
  });

  afterAll(async () => {
    await cleanup.run();
  });

  describe("videos", () => {
    it("Shop A cannot read Shop B's video", async () => {
      expect(await getVideo(shopA.id, videoB.id)).toBeNull();
      expect(await getVideo(shopB.id, videoB.id)).not.toBeNull();
    });

    it("listVideos only returns the shop's own videos", async () => {
      const { items } = await listVideos(shopA.id);
      expect(items.map((v) => v.id)).toEqual([videoA.id]);
    });

    it("a foreign cursor does not leak another shop's rows", async () => {
      expect(await listVideos(shopA.id, { cursor: videoB.id })).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it("Shop A cannot update Shop B's video", async () => {
      expect(await updateVideo(shopA.id, videoB.id, { title: "hacked" })).toBeNull();
      expect((await getVideo(shopB.id, videoB.id)).title).toBe("B video");
    });

    it("Shop A cannot delete Shop B's video", async () => {
      expect(await deleteVideo(shopA.id, videoB.id)).toBe(false);
      expect(await getVideo(shopB.id, videoB.id)).not.toBeNull();
    });

    it("update data cannot reassign id or shopId", async () => {
      const updated = await updateVideo(shopA.id, videoA.id, {
        title: "renamed",
        shopId: shopB.id,
        id: "something-else",
      });
      expect(updated).toMatchObject({ id: videoA.id, shopId: shopA.id, title: "renamed" });
    });

    it("create data cannot set shopId to another shop", async () => {
      const v = await createVideo(shopA.id, { title: "x", shopId: shopB.id });
      expect(v.shopId).toBe(shopA.id);
      await deleteVideo(shopA.id, v.id);
    });
  });

  describe("product tags", () => {
    it("Shop A cannot read Shop B's tags", async () => {
      expect(await listVideoProducts(shopA.id, videoB.id)).toEqual([]);
    });

    it("Shop A cannot tag Shop B's video", async () => {
      await expect(
        setVideoProducts(shopA.id, videoB.id, [{ productGid: PRODUCT, handle: "x" }]),
      ).rejects.toBeInstanceOf(OwnershipError);
      expect(await listVideoProducts(shopB.id, videoB.id)).toHaveLength(1);
    });

    it("Shop A cannot delete or rename Shop B's tags", async () => {
      expect(await deleteProductTags(shopA.id, PRODUCT)).toBe(0);
      expect(await updateProductHandle(shopA.id, PRODUCT, "hacked")).toBe(0);
      const [tag] = await listVideoProducts(shopB.id, videoB.id);
      expect(tag.handle).toBe("b-product");
    });

    it("rejects malformed product input", async () => {
      await expect(
        setVideoProducts(shopA.id, videoA.id, [{ productGid: "123", handle: "x" }]),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("widgets and widget videos", () => {
    it("Shop A cannot read, update or delete Shop B's widget", async () => {
      expect(await getWidget(shopA.id, widgetB.id)).toBeNull();
      expect((await listWidgets(shopA.id)).map((w) => w.id)).toEqual([widgetA.id]);
      expect(await updateWidget(shopA.id, widgetB.id, { name: "hacked" })).toBeNull();
      expect(await deleteWidget(shopA.id, widgetB.id)).toBe(false);
      expect((await getWidget(shopB.id, widgetB.id)).name).toBe("B widget");
    });

    it("Shop A cannot read Shop B's widget videos", async () => {
      expect(await listWidgetVideos(shopA.id, widgetB.id)).toEqual([]);
    });

    it("cannot attach Shop B's video to Shop A's widget", async () => {
      await expect(setWidgetVideos(shopA.id, widgetA.id, [videoB.id])).rejects.toBeInstanceOf(
        OwnershipError,
      );
      await expect(
        setWidgetVideos(shopA.id, widgetA.id, [videoA.id, videoB.id]),
      ).rejects.toBeInstanceOf(OwnershipError);
      expect(await listWidgetVideos(shopA.id, widgetA.id)).toEqual([]);
    });

    it("cannot modify Shop B's widget videos from Shop A", async () => {
      await expect(setWidgetVideos(shopA.id, widgetB.id, [videoA.id])).rejects.toBeInstanceOf(
        OwnershipError,
      );
      expect((await listWidgetVideos(shopB.id, widgetB.id)).map((r) => r.videoId)).toEqual([
        videoB.id,
      ]);
    });

    it("own videos attach in order", async () => {
      const rows = await setWidgetVideos(shopA.id, widgetA.id, [videoA.id]);
      expect(rows).toMatchObject([{ widgetId: widgetA.id, videoId: videoA.id, position: 0 }]);
    });
  });

  describe("placements", () => {
    it("Shop A cannot read or modify Shop B's placements", async () => {
      expect(await listPlacements(shopA.id, widgetB.id)).toEqual([]);
      await expect(
        setPlacements(shopA.id, widgetB.id, [{ pageType: "ALL_PRODUCTS" }]),
      ).rejects.toBeInstanceOf(OwnershipError);
      expect((await listPlacements(shopB.id, widgetB.id)).map((p) => p.pageType)).toEqual([
        "HOME",
      ]);
    });

    it("validates targets per page type", async () => {
      await expect(
        setPlacements(shopA.id, widgetA.id, [{ pageType: "PRODUCT" }]),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        setPlacements(shopA.id, widgetA.id, [{ pageType: "HOME", targetGid: PRODUCT }]),
      ).rejects.toBeInstanceOf(ValidationError);
      const rows = await setPlacements(shopA.id, widgetA.id, [
        { pageType: "PRODUCT", targetGid: PRODUCT },
      ]);
      expect(rows).toHaveLength(1);
    });
  });

  describe("database-level guard (composite foreign keys)", () => {
    it("rejects a WidgetVideo linking Shop A's widget to Shop B's video", async () => {
      await expect(
        prisma.widgetVideo.create({
          data: { shopId: shopA.id, widgetId: widgetA.id, videoId: videoB.id },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("rejects a VideoProduct whose shopId differs from its video's shop", async () => {
      await expect(
        prisma.videoProduct.create({
          // Different product than videoB's existing tag, so only the composite FK can reject it.
          data: {
            shopId: shopA.id,
            videoId: videoB.id,
            productGid: "gid://shopify/Product/2002",
            handle: "x",
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("rejects a Placement on another shop's widget", async () => {
      await expect(
        prisma.placement.create({
          data: { shopId: shopA.id, widgetId: widgetB.id, pageType: "HOME" },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
    });
  });

  describe("cascade delete", () => {
    it("deleting Shop A removes only Shop A's rows", async () => {
      expect(await deleteShop(shopA.id)).toBe(true);
      expect(await prisma.video.count({ where: { shopId: shopA.id } })).toBe(0);
      expect(await prisma.widget.count({ where: { shopId: shopA.id } })).toBe(0);
      expect(await prisma.widgetVideo.count({ where: { shopId: shopA.id } })).toBe(0);
      expect(await prisma.placement.count({ where: { shopId: shopA.id } })).toBe(0);

      expect(await getVideo(shopB.id, videoB.id)).not.toBeNull();
      expect(await listVideoProducts(shopB.id, videoB.id)).toHaveLength(1);
      expect(await listWidgetVideos(shopB.id, widgetB.id)).toHaveLength(1);
      expect(await listPlacements(shopB.id, widgetB.id)).toHaveLength(1);
    });
  });
});
