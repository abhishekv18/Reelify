import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createStreamClient,
  readStreamConfig,
  StreamApiError,
  StreamConfigError,
} from "../../app/services/stream.server.js";

const fixture = (name) => JSON.parse(fs.readFileSync(new URL(`../fixtures/stream/${name}`, import.meta.url), "utf8"));
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const TOKEN = "test-stream-token-not-real";
const UID = "0123456789abcdef0123456789abcdef";

/** Fake fetch that records requests and replies from a queue. */
function fakeFetch(...replies) {
  const requests = [];
  const impl = async (url, init) => {
    requests.push({ url: String(url), method: init.method, headers: init.headers, body: init.body && JSON.parse(init.body) });
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { impl, requests };
}

const client = (f) => createStreamClient({ accountId: ACCOUNT, apiToken: TOKEN, fetch: f.impl });

describe("createDirectUpload", () => {
  it("posts the documented body with the bearer token and returns uid + uploadURL", async () => {
    const f = fakeFetch({ body: fixture("direct-upload.json") });
    const expiry = new Date("2026-10-14T12:30:00.000Z");
    const result = await client(f).createDirectUpload({
      maxDurationSeconds: 180,
      expiry,
      requireSignedURLs: true,
      creator: "shop_123",
      meta: { app: "reelify", shopId: "shop_123", videoId: "vid_1" },
    });

    expect(result).toEqual({ uid: UID, uploadURL: fixture("direct-upload.json").result.uploadURL });
    const [req] = f.requests;
    expect(req.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/direct_upload`);
    expect(req.method).toBe("POST");
    expect(req.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.body).toEqual({
      maxDurationSeconds: 180,
      expiry: "2026-10-14T12:30:00.000Z",
      requireSignedURLs: true,
      creator: "shop_123",
      meta: { app: "reelify", shopId: "shop_123", videoId: "vid_1" },
    });
  });

  it("validates maxDurationSeconds and creator length before calling Stream", async () => {
    const f = fakeFetch();
    await expect(client(f).createDirectUpload({ maxDurationSeconds: 0 })).rejects.toThrow(TypeError);
    await expect(client(f).createDirectUpload({ maxDurationSeconds: 180, creator: "x".repeat(65) })).rejects.toThrow(TypeError);
    expect(f.requests).toHaveLength(0);
  });

  it("rejects a response without uid/uploadURL or with a path-like uid", async () => {
    await expect(client(fakeFetch({ body: { success: true, result: {} } })).createDirectUpload({ maxDurationSeconds: 180 })).rejects.toThrow(StreamApiError);
    await expect(
      client(fakeFetch({ body: { success: true, result: { uid: "../keys", uploadURL: "https://x" } } })).createDirectUpload({ maxDurationSeconds: 180 }),
    ).rejects.toThrow(TypeError);
  });
});

describe("errors never leak secrets", () => {
  it("maps 401 to a non-retryable error without the token or response body", async () => {
    const error = await client(fakeFetch({ status: 401, body: fixture("error-auth.json") }))
      .createDirectUpload({ maxDurationSeconds: 180 })
      .catch((e) => e);
    expect(error).toBeInstanceOf(StreamApiError);
    expect(error).toMatchObject({ status: 401, codes: [10000], retryable: false });
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it("marks 429, 5xx and network errors as retryable", async () => {
    for (const reply of [{ status: 429, body: { success: false, errors: [] } }, { status: 503, body: null }]) {
      const error = await client(fakeFetch(reply)).getVideo(UID).catch((e) => e);
      expect(error.retryable).toBe(true);
    }
    const net = await client(fakeFetch(new TypeError("fetch failed: https://api.cloudflare.com?token=" + TOKEN)))
      .getVideo(UID)
      .catch((e) => e);
    expect(net).toMatchObject({ retryable: true });
    expect(net.message).not.toContain(TOKEN);
    expect(JSON.stringify(net.cause)).not.toContain(TOKEN);
  });

  it("never includes the one-time upload URL in errors", async () => {
    const uploadURL = fixture("direct-upload.json").result.uploadURL;
    const error = await client(fakeFetch({ status: 500, body: fixture("direct-upload.json") }))
      .createDirectUpload({ maxDurationSeconds: 180 })
      .catch((e) => e);
    expect(error.message).not.toContain(uploadURL);
  });
});

describe("getVideo / deleteVideo / updateVideo / listVideos", () => {
  it("returns details, or null for an unknown uid", async () => {
    const f = fakeFetch({ body: fixture("video-ready.json") }, { status: 404, body: { success: false, errors: [{ code: 10003 }] } });
    const c = client(f);
    expect((await c.getVideo(UID)).status.state).toBe("ready");
    expect(await c.getVideo(UID)).toBeNull();
    expect(f.requests[0].url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/stream/${UID}`);
  });

  it("refuses uids that could change the URL path", async () => {
    const f = fakeFetch();
    for (const bad of ["../keys", "a/b", "", "x".repeat(33), "abc?x=1"]) {
      await expect(client(f).getVideo(bad)).rejects.toThrow(TypeError);
      await expect(client(f).deleteVideo(bad)).rejects.toThrow(TypeError);
    }
    expect(f.requests).toHaveLength(0);
  });

  it("treats 404 on delete as already deleted", async () => {
    const f = fakeFetch({ body: { success: true, result: null, errors: [] } }, { status: 404, body: null });
    const c = client(f);
    expect(await c.deleteVideo(UID)).toBe(true);
    expect(await c.deleteVideo(UID)).toBe(false);
    expect(f.requests[0].method).toBe("DELETE");
  });

  it("only sends requireSignedURLs/thumbnailTimestampPct on update", async () => {
    const f = fakeFetch({ body: fixture("video-ready.json") });
    await client(f).updateVideo(UID, { requireSignedURLs: true, creator: "evil" });
    expect(f.requests[0]).toMatchObject({ method: "POST", body: { requireSignedURLs: true } });
    expect(f.requests[0].body).not.toHaveProperty("creator");
  });

  it("passes list filters as query parameters", async () => {
    const f = fakeFetch({ body: { success: true, result: [], errors: [] } });
    await client(f).listVideos({ creator: "shop_1", status: "ready", limit: 10, before: new Date("2026-10-01T00:00:00Z") });
    const url = new URL(f.requests[0].url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      creator: "shop_1",
      status: "ready",
      limit: "10",
      before: "2026-10-01T00:00:00.000Z",
    });
  });
});

describe("readStreamConfig", () => {
  it("names missing variables without echoing values", () => {
    expect(() => readStreamConfig({})).toThrow(StreamConfigError);
    expect(() => readStreamConfig({ CLOUDFLARE_ACCOUNT_ID: ACCOUNT })).toThrow(/CLOUDFLARE_STREAM_API_TOKEN/);
    const err = (() => {
      try {
        readStreamConfig({ CLOUDFLARE_ACCOUNT_ID: "not-an-id-secret-ish", CLOUDFLARE_STREAM_API_TOKEN: TOKEN });
      } catch (e) {
        return e;
      }
    })();
    expect(err.message).not.toContain("not-an-id-secret-ish");
    expect(readStreamConfig({ CLOUDFLARE_ACCOUNT_ID: ` ${ACCOUNT} `, CLOUDFLARE_STREAM_API_TOKEN: TOKEN })).toEqual({
      accountId: ACCOUNT,
      apiToken: TOKEN,
    });
  });
});
