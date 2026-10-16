import { afterAll, describe, expect, it, vi } from "vitest";
import { createCleanup, createTestShop, hasTestDb, prisma } from "../helpers/db.js";
import { createFakeStream, streamVideo } from "../helpers/fakeStream.js";
import { completeUpload, createUpload, UploadError } from "../../app/services/uploads.server.js";
import { syncVideoFromStream } from "../../app/services/videoSync.server.js";
import { createVideo, getVideo } from "../../app/repositories/videos.server.js";

const silent = { error: vi.fn(), warn: vi.fn() };
const body = (over = {}) => ({
  filename: "clip.mp4",
  contentType: "video/mp4",
  sizeBytes: 5_000_000,
  rightsConfirmed: true,
  ...over,
});
const expectUploadError = async (promise, status, code) => {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(UploadError);
  expect(error).toMatchObject({ status, code });
  return error;
};

describe.skipIf(!hasTestDb)("upload flow (mocked Stream, test DB)", () => {
  const cleanup = createCleanup();
  afterAll(() => cleanup.run());

  /** Starts an upload for a fresh shop and returns everything a test needs. */
  async function started(over) {
    const shop = await createTestShop(cleanup);
    const stream = createFakeStream();
    const res = await createUpload(shop, body(over), { stream, logger: silent });
    const row = await getVideo(shop.id, res.videoId);
    return { shop, stream, res, row };
  }

  describe("createUpload", () => {
    it("creates an UPLOAD_PENDING row and a private, constrained Stream direct upload", async () => {
      const now = new Date("2026-10-14T10:00:00.000Z");
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      const res = await createUpload(shop, body({ shopId: "someone-else" }), { stream, now, logger: silent });

      const [params] = stream.calls.createDirectUpload;
      expect(params).toMatchObject({
        maxDurationSeconds: 180,
        requireSignedURLs: true,
        creator: shop.id,
        meta: { app: "reelify", shopId: shop.id, videoId: res.videoId },
      });
      expect(params.expiry.toISOString()).toBe("2026-10-14T10:30:00.000Z");

      const row = await getVideo(shop.id, res.videoId);
      expect(row).toMatchObject({
        shopId: shop.id,
        status: "UPLOAD_PENDING",
        source: "UPLOAD",
        mimeType: "video/mp4",
        sizeBytes: 5_000_000,
        title: "clip",
        streamState: "pendingupload",
      });
      expect(row.streamUid).toMatch(/^[0-9a-f]{32}$/);
      expect(row.uploadExpiresAt.toISOString()).toBe(res.expiresAt);
      expect(row.rightsConfirmedAt).toEqual(now);
      expect(res.uploadURL).toContain(row.streamUid);
    });

    it.each([
      [{ contentType: "image/png" }, "UNSUPPORTED_TYPE"],
      [{ sizeBytes: 200_000_001 }, "TOO_LARGE"],
      [{ sizeBytes: 0 }, "INVALID_SIZE"],
      [{ rightsConfirmed: false }, "RIGHTS_NOT_CONFIRMED"],
    ])("rejects %o (%s) before any row or Stream call", async (over, code) => {
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      await expectUploadError(createUpload(shop, body(over), { stream, logger: silent }), 400, code);
      expect(stream.calls.createDirectUpload).toHaveLength(0);
      expect(await prisma.video.count({ where: { shopId: shop.id } })).toBe(0);
    });

    it("enforces the video count limit and ignores FAILED videos", async () => {
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      await prisma.video.createMany({
        data: [
          ...Array.from({ length: 9 }, () => ({ shopId: shop.id, status: "READY", durationMs: 10_000 })),
          ...Array.from({ length: 3 }, () => ({ shopId: shop.id, status: "FAILED" })),
        ],
      });
      await createUpload(shop, body(), { stream, logger: silent }); // 10th active video
      await expectUploadError(createUpload(shop, body(), { stream, logger: silent }), 403, "VIDEO_LIMIT");
    });

    it("enforces stored minutes, counting unfinished uploads as a full 180 s reservation", async () => {
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      // 27.5 min stored + 1 unfinished upload (3 min reserved) = 30.5 min → no room for another 3 min.
      await prisma.video.createMany({
        data: [
          { shopId: shop.id, status: "READY", durationMs: 27.5 * 60 * 1000 },
          { shopId: shop.id, status: "PROCESSING" },
        ],
      });
      await expectUploadError(createUpload(shop, body(), { stream, logger: silent }), 403, "MINUTES_LIMIT");
    });

    it("is concurrency-safe at the limit: 8 existing, 5 parallel → exactly 2 succeed", async () => {
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      await prisma.video.createMany({
        data: Array.from({ length: 8 }, () => ({ shopId: shop.id, status: "READY", durationMs: 1000 })),
      });
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => createUpload(shop, body(), { stream, logger: silent })),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      for (const r of results.filter((x) => x.status === "rejected")) {
        expect(r.reason).toMatchObject({ status: 403, code: "VIDEO_LIMIT" });
      }
      expect(await prisma.video.count({ where: { shopId: shop.id } })).toBe(10);
    });

    it("leaves no row behind when Stream fails", async () => {
      const shop = await createTestShop(cleanup);
      const stream = createFakeStream();
      stream.failNextCall({ status: 503, retryable: true });
      const error = await expectUploadError(createUpload(shop, body(), { stream, logger: silent }), 502, "STREAM_UNAVAILABLE");
      expect(error.message).not.toMatch(/https?:/);
      expect(await prisma.video.count({ where: { shopId: shop.id } })).toBe(0);
    });
  });

  describe("completeUpload / syncVideoFromStream", () => {
    it("keeps the row pending (409) until Stream has received the file", async () => {
      const { shop, stream, res } = await started();
      await expectUploadError(completeUpload(shop, res.videoId, { stream, logger: silent }), 409, "UPLOAD_NOT_RECEIVED");
      expect((await getVideo(shop.id, res.videoId)).status).toBe("UPLOAD_PENDING");
    });

    it.each([
      ["queued", "UPLOADED"],
      ["downloading", "UPLOADED"],
      ["inprogress", "PROCESSING"],
    ])("Stream %s → %s", async (state, status) => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state });
      expect(await completeUpload(shop, res.videoId, { stream, logger: silent })).toMatchObject({ status });
    });

    it("Stream ready → READY with duration, size and dimensions from the API", async () => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "ready", duration: 12.5, size: 4_567_890, input: { width: 1080, height: 1920 } });
      expect(await completeUpload(shop, res.videoId, { stream, logger: silent })).toEqual({
        videoId: res.videoId,
        status: "READY",
        errorCode: null,
        errorMessage: null,
      });
      expect(await getVideo(shop.id, res.videoId)).toMatchObject({
        durationMs: 12_500,
        sizeBytes: 4_567_890,
        width: 1080,
        height: 1920,
        streamState: "ready",
      });
    });

    it.each([
      ["ERR_NON_VIDEO", "INVALID_FILE"],
      ["ERR_DURATION_EXCEED_CONSTRAINT", "TOO_LONG"],
      ["ERR_UNKNOWN", "TRANSCODE_ERROR"],
    ])("Stream error %s → FAILED %s", async (reason, code) => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "error", errorReasonCode: reason });
      const result = await completeUpload(shop, res.videoId, { stream, logger: silent });
      expect(result).toMatchObject({ status: "FAILED", errorCode: code });
      expect(result.errorMessage).toMatch(/\w/);
    });

    it("re-checks D9: Stream-accepted video over 180 s → FAILED TOO_LONG and deleted from Stream", async () => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "ready", duration: 200 });
      expect(await completeUpload(shop, res.videoId, { stream, logger: silent })).toMatchObject({
        status: "FAILED",
        errorCode: "TOO_LONG",
      });
      expect(stream.calls.deleteVideo).toEqual([row.streamUid]);
    });

    it("re-checks D9: over 200,000,000 bytes → FAILED TOO_LARGE and deleted from Stream", async () => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "ready", duration: 30, size: 250_000_000 });
      expect(await completeUpload(shop, res.videoId, { stream, logger: silent })).toMatchObject({
        status: "FAILED",
        errorCode: "TOO_LARGE",
      });
      expect(stream.calls.deleteVideo).toEqual([row.streamUid]);
    });

    it("is forward-only: READY never moves back, PROCESSING ignores a stale queued state", async () => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "inprogress" });
      await completeUpload(shop, res.videoId, { stream, logger: silent });
      stream.setState(row.streamUid, { state: "queued" });
      const stale = await syncVideoFromStream(await getVideo(shop.id, res.videoId), { stream, logger: silent });
      expect(stale.outcome).toBe("UNCHANGED");
      expect(stale.video.status).toBe("PROCESSING");

      stream.setState(row.streamUid, { state: "ready", duration: 5 });
      await completeUpload(shop, res.videoId, { stream, logger: silent });
      stream.setState(row.streamUid, { state: "inprogress", readyToStream: false });
      const later = await syncVideoFromStream(await getVideo(shop.id, res.videoId), { stream, logger: silent });
      expect(later).toMatchObject({ outcome: "UNCHANGED" });
      expect(later.video.status).toBe("READY");
      // Terminal videos do not even call Stream on /complete.
      const calls = stream.calls.getVideo.length;
      expect((await completeUpload(shop, res.videoId, { stream, logger: silent })).status).toBe("READY");
      expect(stream.calls.getVideo.length).toBe(calls);
    });

    it("concurrent completes converge: exactly one transition to READY", async () => {
      const { shop, stream, row } = await started();
      stream.setState(row.streamUid, { state: "ready", duration: 5 });
      const pending = await getVideo(shop.id, row.id);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => syncVideoFromStream(pending, { stream, logger: silent })),
      );
      // The same-status refresh rule means non-terminal duplicates may also "update"; READY is reached once.
      expect(results.filter((r) => r.outcome === "UPDATED")).toHaveLength(1);
      expect((await getVideo(shop.id, row.id)).status).toBe("READY");
    });

    it("re-enables signed URLs if Stream reports the video as public", async () => {
      const { shop, stream, res, row } = await started();
      stream.setState(row.streamUid, { state: "inprogress", requireSignedURLs: false });
      await completeUpload(shop, res.videoId, { stream, logger: silent });
      expect(stream.calls.updateVideo).toEqual([{ uid: row.streamUid, settings: { requireSignedURLs: true } }]);
    });

    it("changes nothing when Stream's creator/meta do not match the row (ownership check)", async () => {
      const { shop, stream, res, row } = await started();
      const other = await createTestShop(cleanup);
      stream.videos.set(row.streamUid, streamVideo({ uid: row.streamUid, creator: other.id, videoId: res.videoId, state: "ready" }));
      await expectUploadError(completeUpload(shop, res.videoId, { stream, logger: silent }), 409, "VERIFICATION_FAILED");
      expect((await getVideo(shop.id, res.videoId)).status).toBe("UPLOAD_PENDING");

      stream.videos.set(row.streamUid, streamVideo({ uid: row.streamUid, creator: shop.id, videoId: "another-video", state: "ready" }));
      await expectUploadError(completeUpload(shop, res.videoId, { stream, logger: silent }), 409, "VERIFICATION_FAILED");
    });

    it("another shop cannot complete (or probe) this shop's upload", async () => {
      const { stream, res, row } = await started();
      const attacker = await createTestShop(cleanup);
      stream.setState(row.streamUid, { state: "ready", duration: 5 });
      await expectUploadError(completeUpload(attacker, res.videoId, { stream, logger: silent }), 404, "NOT_FOUND");
      expect(stream.calls.getVideo).toHaveLength(0);
      expect((await getVideo(row.shopId, res.videoId)).status).toBe("UPLOAD_PENDING");
    });

    it("Stream 404: a processing video fails as SOURCE_UNAVAILABLE; a pending one is left for the reconciler", async () => {
      const a = await started();
      a.stream.setState(a.row.streamUid, { state: "inprogress" });
      await completeUpload(a.shop, a.res.videoId, { stream: a.stream, logger: silent });
      a.stream.videos.delete(a.row.streamUid);
      expect(
        (await syncVideoFromStream(await getVideo(a.shop.id, a.res.videoId), { stream: a.stream, logger: silent })).video,
      ).toMatchObject({ status: "FAILED", errorCode: "SOURCE_UNAVAILABLE" });

      const b = await started();
      b.stream.videos.delete(b.row.streamUid);
      const r = await syncVideoFromStream(b.row, { stream: b.stream, logger: silent });
      expect(r.outcome).toBe("NOT_FOUND");
      expect((await getVideo(b.shop.id, b.res.videoId)).status).toBe("UPLOAD_PENDING");
    });

    it("Stream API errors on complete → 502 and the row is unchanged", async () => {
      const { shop, stream, res } = await started();
      stream.failNextCall({ status: 500, retryable: true });
      await expectUploadError(completeUpload(shop, res.videoId, { stream, logger: silent }), 502, "STREAM_UNAVAILABLE");
      expect((await getVideo(shop.id, res.videoId)).status).toBe("UPLOAD_PENDING");
    });

    it("a video without a Stream uid cannot be completed", async () => {
      const shop = await createTestShop(cleanup);
      const v = await createVideo(shop.id, { status: "UPLOAD_PENDING" });
      await expectUploadError(completeUpload(shop, v.id, { stream: createFakeStream(), logger: silent }), 409, "UPLOAD_NOT_STARTED");
    });
  });
});
