/**
 * Signed playback for private Stream videos (D10: every video has requireSignedURLs: true).
 *
 * Tokens are RS256 JWTs signed locally with the Stream signing key (no API call per token):
 *   header  { alg: "RS256", kid }
 *   payload { sub: <video uid>, kid, exp, nbf }        exp ≤ 24 h (Stream limit)
 * The token replaces the uid in Stream URLs (iframe, manifest, thumbnails).
 * https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
 *
 * Config: CLOUDFLARE_STREAM_SIGNING_KEY_ID, CLOUDFLARE_STREAM_SIGNING_KEY_JWK (base64 JWK from POST /stream/keys),
 *         CLOUDFLARE_STREAM_CUSTOMER_CODE. Never log tokens or signed URLs.
 */
import crypto from "node:crypto";
import { assertStreamUid } from "./stream.server.js";

export const MAX_TOKEN_TTL_SECONDS = 24 * 60 * 60;
/** Allow for small clock differences between us and Cloudflare. */
const NOT_BEFORE_SKEW_SECONDS = 60;

export class PlaybackConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "PlaybackConfigError";
  }
}

/** @param {string} value base64 or raw JSON JWK */
function parseJwk(value) {
  const trimmed = value.trim();
  const json = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  try {
    return JSON.parse(json);
  } catch {
    throw new PlaybackConfigError("CLOUDFLARE_STREAM_SIGNING_KEY_JWK is not a valid (base64) JWK.");
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ keyId: string, privateKey: crypto.KeyObject, customerCode: string }}
 */
export function readPlaybackConfig(env = process.env) {
  const keyId = env.CLOUDFLARE_STREAM_SIGNING_KEY_ID?.trim();
  const jwk = env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK;
  const customerCode = env.CLOUDFLARE_STREAM_CUSTOMER_CODE?.trim();
  if (!keyId) throw new PlaybackConfigError("CLOUDFLARE_STREAM_SIGNING_KEY_ID is not set.");
  if (!jwk) throw new PlaybackConfigError("CLOUDFLARE_STREAM_SIGNING_KEY_JWK is not set.");
  if (!customerCode) throw new PlaybackConfigError("CLOUDFLARE_STREAM_CUSTOMER_CODE is not set.");
  if (!/^[a-z0-9]+$/.test(customerCode)) {
    throw new PlaybackConfigError("CLOUDFLARE_STREAM_CUSTOMER_CODE must be the code from customer-<CODE>.cloudflarestream.com.");
  }

  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({ key: parseJwk(jwk), format: "jwk" });
  } catch (error) {
    if (error instanceof PlaybackConfigError) throw error;
    throw new PlaybackConfigError("CLOUDFLARE_STREAM_SIGNING_KEY_JWK is not a usable RSA private key.");
  }
  if (privateKey.asymmetricKeyType !== "rsa") {
    throw new PlaybackConfigError("CLOUDFLARE_STREAM_SIGNING_KEY_JWK must be an RSA key.");
  }
  return { keyId, privateKey, customerCode };
}

/** @param {Buffer | string} input */
function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

/**
 * Signs a playback token for one video.
 * @param {{ uid: string, ttlSeconds: number, keyId: string, privateKey: crypto.KeyObject, now?: Date }} params
 * @returns {{ token: string, expiresAt: Date }}
 */
export function signStreamToken({ uid, ttlSeconds, keyId, privateKey, now = new Date() }) {
  assertStreamUid(uid);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TOKEN_TTL_SECONDS) {
    throw new RangeError(`ttlSeconds must be an integer between 1 and ${MAX_TOKEN_TTL_SECONDS}.`);
  }
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlSeconds;
  const header = base64url(JSON.stringify({ alg: "RS256", kid: keyId }));
  const payload = base64url(JSON.stringify({ sub: uid, kid: keyId, exp, nbf: iat - NOT_BEFORE_SKEW_SECONDS }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
  return { token: `${header}.${payload}.${base64url(signature)}`, expiresAt: new Date(exp * 1000) };
}

/** @param {string} customerCode */
function mediaBase(customerCode) {
  return `https://customer-${customerCode}.cloudflarestream.com`;
}

/**
 * Builds Stream media URLs for a signed token (or, in tests, any id-shaped value).
 * Thumbnail/GIF parameters: https://developers.cloudflare.com/stream/viewing-videos/displaying-thumbnails/
 * @param {string} customerCode
 * @param {string} token
 */
export function buildMediaUrls(customerCode, token) {
  const base = `${mediaBase(customerCode)}/${encodeURIComponent(token)}`;
  const poster = `${base}/thumbnails/thumbnail.jpg?time=1s&height=640`;
  return {
    iframeUrl:
      `${base}/iframe?muted=true&preload=none&letterboxColor=transparent` +
      `&poster=${encodeURIComponent(poster)}`,
    hlsUrl: `${base}/manifest/video.m3u8`,
    posterUrl: poster,
    previewUrl: `${base}/thumbnails/thumbnail.gif?time=0s&duration=4s&height=360&fps=8`,
  };
}

/**
 * Signed media URLs for one of the caller's videos. Callers must already have checked ownership
 * (and, for the storefront, that the video is READY).
 * @param {{ streamUid: string | null }} video
 * @param {{ ttlSeconds: number, now?: Date, config?: ReturnType<typeof readPlaybackConfig> }} options
 */
export function signedMediaUrls(video, { ttlSeconds, now, config = readPlaybackConfig() }) {
  if (!video?.streamUid) throw new TypeError("Video has no Stream uid.");
  const { token, expiresAt } = signStreamToken({
    uid: video.streamUid,
    ttlSeconds,
    keyId: config.keyId,
    privateKey: config.privateKey,
    now,
  });
  return { ...buildMediaUrls(config.customerCode, token), expiresAt };
}
