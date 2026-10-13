/**
 * AES-256-GCM encryption for secrets at rest (e.g. Instagram access tokens).
 *
 * Configuration (env):
 *   ENCRYPTION_KEY           current key, 64 hex characters (= 32 bytes)
 *   ENCRYPTION_KEY_VERSION   positive integer identifying ENCRYPTION_KEY
 *   ENCRYPTION_KEY_V<n>      optional older keys (same format) kept for decryption after rotation
 *
 * Ciphertext format (single string, safe to store in a TEXT column):
 *   v<keyVersion>.<iv>.<authTag>.<ciphertext>
 * where iv (12 random bytes per call), authTag (16 bytes) and ciphertext are base64url.
 * Callers also store `keyVersion` in its own column (e.g. SocialAccount.keyVersion).
 *
 * Optional `aad` (additional authenticated data, e.g. the shopId) binds a ciphertext to its owner:
 * decrypting with a different aad fails, so tokens cannot be swapped between rows.
 *
 * Never log plaintext, keys or ciphertext. Errors never include key material.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX = /^[0-9a-f]{64}$/i;
const FORMAT = /^v(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/;

/** Encryption is misconfigured (missing or malformed key / version). */
export class CryptoConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "CryptoConfigError";
  }
}

/** Decryption failed (tampered, wrong key, wrong aad, malformed input). Deliberately vague. */
export class CryptoError extends Error {
  constructor() {
    super("Decryption failed");
    this.name = "CryptoError";
  }
}

/**
 * @param {string | undefined} value
 * @param {string} name env var name (for the error message only)
 */
function parseKey(value, name) {
  if (!value) throw new CryptoConfigError(`${name} is not set.`);
  const trimmed = value.trim();
  if (!KEY_HEX.test(trimmed)) {
    throw new CryptoConfigError(`${name} must be 64 hex characters (32 bytes).`);
  }
  return Buffer.from(trimmed, "hex");
}

/** @param {string | undefined} value */
function parseVersion(value) {
  if (!value || !/^\d+$/.test(value.trim()) || Number(value) < 1) {
    throw new CryptoConfigError("ENCRYPTION_KEY_VERSION must be a positive integer.");
  }
  return Number(value);
}

/**
 * Reads the key ring from the environment. Exported for tests; not cached so that
 * configuration problems surface on every call instead of being hidden.
 * @param {Record<string, string | undefined>} [env]
 */
export function loadKeyRing(env = process.env) {
  const currentVersion = parseVersion(env.ENCRYPTION_KEY_VERSION);
  /** @type {Map<number, Buffer>} */
  const keys = new Map([[currentVersion, parseKey(env.ENCRYPTION_KEY, "ENCRYPTION_KEY")]]);
  for (const [name, value] of Object.entries(env)) {
    const match = /^ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match) continue;
    const version = Number(match[1]);
    if (version === currentVersion || !value) continue;
    keys.set(version, parseKey(value, name));
  }
  return { currentVersion, keys };
}

/** @param {string | undefined} aad */
function aadBuffer(aad) {
  return aad === undefined ? null : Buffer.from(String(aad), "utf8");
}

/**
 * @param {string} plaintext
 * @param {{ aad?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {{ ciphertext: string, keyVersion: number }}
 */
export function encrypt(plaintext, { aad, env } = {}) {
  if (typeof plaintext !== "string") {
    throw new TypeError("encrypt() expects a string.");
  }
  const { currentVersion, keys } = loadKeyRing(env);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keys.get(currentVersion), iv, {
    authTagLength: TAG_BYTES,
  });
  const aadBuf = aadBuffer(aad);
  if (aadBuf) cipher.setAAD(aadBuf);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: [
      `v${currentVersion}`,
      iv.toString("base64url"),
      tag.toString("base64url"),
      ct.toString("base64url"),
    ].join("."),
    keyVersion: currentVersion,
  };
}

/**
 * @param {string} ciphertext value produced by encrypt()
 * @param {{ aad?: string, env?: Record<string, string | undefined> }} [options]
 * @returns {string}
 */
export function decrypt(ciphertext, { aad, env } = {}) {
  const { keys } = loadKeyRing(env);
  const match = typeof ciphertext === "string" ? FORMAT.exec(ciphertext) : null;
  if (!match) throw new CryptoError();

  const key = keys.get(Number(match[1]));
  const iv = Buffer.from(match[2], "base64url");
  const tag = Buffer.from(match[3], "base64url");
  if (!key || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new CryptoError();

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    const aadBuf = aadBuffer(aad);
    if (aadBuf) decipher.setAAD(aadBuf);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(match[4], "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CryptoError();
  }
}
