import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildMediaUrls,
  MAX_TOKEN_TTL_SECONDS,
  PlaybackConfigError,
  readPlaybackConfig,
  signedMediaUrls,
  signStreamToken,
} from "../../app/services/playback.server.js";

// Test-only RSA key generated per run (Stream issues RSA signing keys as base64 JWK).
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" }))).toString("base64");
const env = {
  CLOUDFLARE_STREAM_SIGNING_KEY_ID: "testkid123",
  CLOUDFLARE_STREAM_SIGNING_KEY_JWK: jwkBase64,
  CLOUDFLARE_STREAM_CUSTOMER_CODE: "abc123xyz",
};
const UID = "0123456789abcdef0123456789abcdef";
const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("signStreamToken", () => {
  const config = readPlaybackConfig(env);
  const now = new Date("2026-10-14T10:00:00Z");

  it("produces an RS256 JWT that verifies with the public key", () => {
    const { token, expiresAt } = signStreamToken({ uid: UID, ttlSeconds: 3600, keyId: config.keyId, privateKey: config.privateKey, now });
    const [h, p, s] = token.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", kid: "testkid123" });
    const payload = decode(p);
    expect(payload).toMatchObject({ sub: UID, kid: "testkid123", exp: Math.floor(now.getTime() / 1000) + 3600 });
    expect(payload.nbf).toBeLessThanOrEqual(Math.floor(now.getTime() / 1000));
    expect(expiresAt.toISOString()).toBe("2026-10-14T11:00:00.000Z");
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("caps tokens at 24 hours (Stream limit)", () => {
    expect(MAX_TOKEN_TTL_SECONDS).toBe(86400);
    expect(() => signStreamToken({ uid: UID, ttlSeconds: 86401, keyId: "k", privateKey: config.privateKey })).toThrow(RangeError);
    expect(() => signStreamToken({ uid: UID, ttlSeconds: 0, keyId: "k", privateKey: config.privateKey })).toThrow(RangeError);
  });

  it("refuses invalid uids", () => {
    expect(() => signStreamToken({ uid: "../x", ttlSeconds: 60, keyId: "k", privateKey: config.privateKey })).toThrow(TypeError);
  });
});

describe("media URLs", () => {
  it("puts the token (never the bare uid) into every URL", () => {
    const urls = signedMediaUrls({ streamUid: UID }, { ttlSeconds: 600, config: readPlaybackConfig(env) });
    for (const key of ["iframeUrl", "hlsUrl", "posterUrl", "previewUrl"]) {
      expect(urls[key].startsWith("https://customer-abc123xyz.cloudflarestream.com/ey")).toBe(true);
      expect(urls[key]).not.toContain(`/${UID}/`);
    }
    expect(urls.posterUrl).toMatch(/\/thumbnails\/thumbnail\.jpg\?/);
    expect(urls.previewUrl).toMatch(/\/thumbnails\/thumbnail\.gif\?/);
    expect(urls.hlsUrl).toMatch(/\/manifest\/video\.m3u8$/);
    expect(urls.iframeUrl).toMatch(/\/iframe\?muted=true&preload=none/);
  });

  it("builds iframe URLs without fullscreen/autoplay-with-sound parameters", () => {
    const { iframeUrl } = buildMediaUrls("abc", "TOKEN");
    expect(iframeUrl).not.toMatch(/autoplay/);
    expect(new URL(iframeUrl).searchParams.get("poster")).toBe(
      "https://customer-abc.cloudflarestream.com/TOKEN/thumbnails/thumbnail.jpg?time=1s&height=640",
    );
  });
});

describe("readPlaybackConfig", () => {
  it("names missing or bad variables without echoing secrets", () => {
    expect(() => readPlaybackConfig({ ...env, CLOUDFLARE_STREAM_SIGNING_KEY_ID: "" })).toThrow(/SIGNING_KEY_ID/);
    expect(() => readPlaybackConfig({ ...env, CLOUDFLARE_STREAM_CUSTOMER_CODE: "Bad Code" })).toThrow(PlaybackConfigError);
    const err = (() => {
      try {
        readPlaybackConfig({ ...env, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: "c2VjcmV0LW5vdC1qc29u" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(PlaybackConfigError);
    expect(err.message).not.toContain("c2VjcmV0LW5vdC1qc29u");
  });

  it("rejects non-RSA keys", () => {
    const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
    expect(() =>
      readPlaybackConfig({ ...env, CLOUDFLARE_STREAM_SIGNING_KEY_JWK: JSON.stringify(ec) }),
    ).toThrow(/RSA/);
  });
});
