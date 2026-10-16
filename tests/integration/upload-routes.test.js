/**
 * Route-level tests for POST /app/api/uploads and POST /app/api/uploads/:id/complete.
 * authenticate.admin is mocked (the real auth path is covered in shopify-auth.test.js);
 * the Stream client is the in-memory fake.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createCleanup, hasTestDb, prisma, uniqueShopDomain } from "../helpers/db.js";
import { createFakeStream } from "../helpers/fakeStream.js";

const auth = vi.hoisted(() => ({ admin: vi.fn() }));
const fake = vi.hoisted(() => ({ stream: null }));

vi.mock("../../app/shopify.server.js", () => ({ authenticate: auth, default: {} }));
vi.mock("../../app/services/stream.server.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getStreamClient: () => fake.stream,
}));

const { action: createAction, loader: createLoader } = await import("../../app/routes/app.api.uploads.jsx");
const { action: completeAction } = await import("../../app/routes/app.api.uploads.$id.complete.jsx");

const post = (body, headers = { "Content-Type": "application/json" }) =>
  new Request("https://reelify.test/app/api/uploads", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const validBody = { filename: "a.mp4", contentType: "video/mp4", sizeBytes: 1000, rightsConfirmed: true };

describe.skipIf(!hasTestDb)("upload API routes", () => {
  const cleanup = createCleanup();
  const shopA = cleanup.shop(uniqueShopDomain());
  const shopB = cleanup.shop(uniqueShopDomain());

  beforeEach(() => {
    fake.stream = createFakeStream();
    auth.admin.mockReset();
    auth.admin.mockResolvedValue({ session: { shop: shopA } });
  });
  afterAll(() => cleanup.run());

  it("creates an upload for the session's shop and ignores a shopId in the body", async () => {
    const other = await prisma.shop.create({ data: { shopDomain: shopB } });
    const res = await createAction({ request: post({ ...validBody, shopId: other.id }) });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const data = await res.json();
    expect(Object.keys(data).sort()).toEqual(["expiresAt", "uploadURL", "videoId"]);

    const row = await prisma.video.findUnique({ where: { id: data.videoId }, include: { shop: true } });
    expect(row.shop.shopDomain).toBe(shopA);
    expect(fake.stream.calls.createDirectUpload[0].creator).toBe(row.shopId);
  });

  it("propagates authentication failures and creates nothing", async () => {
    auth.admin.mockRejectedValue(new Response(null, { status: 401 }));
    const before = await prisma.video.count();
    await expect(createAction({ request: post(validBody) })).rejects.toMatchObject({ status: 401 });
    expect(await prisma.video.count()).toBe(before);
    expect(fake.stream.calls.createDirectUpload).toHaveLength(0);
  });

  it("allows POST only", async () => {
    expect(createLoader().status).toBe(405);
    const res = await createAction({ request: new Request("https://reelify.test/app/api/uploads", { method: "PUT" }) });
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it.each([
    ["non-JSON content type", post(validBody, { "Content-Type": "text/plain" }), 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["oversized body", post({ ...validBody, filename: "x".repeat(5000) }), 413, "BODY_TOO_LARGE"],
    ["malformed JSON", post("{not json"), 400, "INVALID_JSON"],
    ["invalid upload", post({ ...validBody, contentType: "text/html" }), 400, "UNSUPPORTED_TYPE"],
  ])("rejects %s", async (_label, request, status, code) => {
    const res = await createAction({ request });
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("completes only the session shop's uploads (404 for another shop's id)", async () => {
    const created = await (await createAction({ request: post(validBody) })).json();
    const row = await prisma.video.findUnique({ where: { id: created.videoId } });
    fake.stream.setState(row.streamUid, { state: "inprogress" });

    auth.admin.mockResolvedValue({ session: { shop: shopB } });
    const foreign = await completeAction({ request: post({}), params: { id: created.videoId } });
    expect(foreign.status).toBe(404);

    auth.admin.mockResolvedValue({ session: { shop: shopA } });
    const own = await completeAction({ request: post({}), params: { id: created.videoId } });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ videoId: created.videoId, status: "PROCESSING" });
  });

  it("returns generic errors without internal details or secrets", async () => {
    fake.stream.failNextCall({ status: 401, retryable: false });
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createAction({ request: post(validBody) });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toMatch(/https?:|token|Bearer|CLOUDFLARE/i);
    for (const call of logger.mock.calls) expect(JSON.stringify(call)).not.toMatch(/https?:\/\/upload|Bearer/);
    logger.mockRestore();
  });
});
