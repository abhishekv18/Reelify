import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CryptoConfigError,
  CryptoError,
  decrypt,
  encrypt,
} from "../../app/services/crypto.server.js";

// Test-only keys generated per run; never real secrets.
const KEY_V1 = randomBytes(32).toString("hex");
const KEY_V2 = randomBytes(32).toString("hex");
const env = { ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: "1" };

/** Flips one character of the n-th dot-separated segment. */
function tamper(ciphertext, segment) {
  const parts = ciphertext.split(".");
  const s = parts[segment];
  parts[segment] = (s[0] === "A" ? "B" : "A") + s.slice(1);
  return parts.join(".");
}

describe("crypto.server", () => {
  it("round-trips plaintext", () => {
    const { ciphertext, keyVersion } = encrypt("IGQVJ-secret-token", { env });
    expect(keyVersion).toBe(1);
    expect(ciphertext).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(ciphertext).not.toContain("secret");
    expect(decrypt(ciphertext, { env })).toBe("IGQVJ-secret-token");
  });

  it("round-trips empty and unicode strings", () => {
    for (const value of ["", "токен 🔐 ünïcode"]) {
      expect(decrypt(encrypt(value, { env }).ciphertext, { env })).toBe(value);
    }
  });

  it("uses a fresh IV for every encryption", () => {
    const a = encrypt("same", { env }).ciphertext;
    const b = encrypt("same", { env }).ciphertext;
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it.each([
    ["iv", 1],
    ["auth tag", 2],
    ["ciphertext", 3],
  ])("rejects a tampered %s", (_name, segment) => {
    const { ciphertext } = encrypt("token-value", { env });
    expect(() => decrypt(tamper(ciphertext, segment), { env })).toThrow(CryptoError);
  });

  it("rejects malformed input and unknown key versions", () => {
    const { ciphertext } = encrypt("token-value", { env });
    expect(() => decrypt("not-a-ciphertext", { env })).toThrow(CryptoError);
    expect(() => decrypt(ciphertext.replace(/^v1/, "v9"), { env })).toThrow(CryptoError);
    expect(() => decrypt(ciphertext.split(".").slice(0, 3).join("."), { env })).toThrow(CryptoError);
  });

  it("binds ciphertext to its AAD (e.g. shopId)", () => {
    const { ciphertext } = encrypt("token-value", { aad: "shop_A", env });
    expect(decrypt(ciphertext, { aad: "shop_A", env })).toBe("token-value");
    expect(() => decrypt(ciphertext, { aad: "shop_B", env })).toThrow(CryptoError);
    expect(() => decrypt(ciphertext, { env })).toThrow(CryptoError);
  });

  it("decrypts with an older key version after rotation", () => {
    const { ciphertext } = encrypt("old-token", { env });
    const rotated = { ENCRYPTION_KEY: KEY_V2, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_V1: KEY_V1 };
    expect(decrypt(ciphertext, { env: rotated })).toBe("old-token");
    expect(encrypt("new-token", { env: rotated }).keyVersion).toBe(2);
    // A ciphertext from key v1 cannot be read once v1 is removed.
    expect(() =>
      decrypt(ciphertext, { env: { ENCRYPTION_KEY: KEY_V2, ENCRYPTION_KEY_VERSION: "2" } }),
    ).toThrow(CryptoError);
  });

  it.each([
    ["missing key", { ENCRYPTION_KEY_VERSION: "1" }],
    ["short key", { ENCRYPTION_KEY: "abcd", ENCRYPTION_KEY_VERSION: "1" }],
    ["non-hex key", { ENCRYPTION_KEY: "z".repeat(64), ENCRYPTION_KEY_VERSION: "1" }],
    ["31-byte key", { ENCRYPTION_KEY: KEY_V1.slice(0, 62), ENCRYPTION_KEY_VERSION: "1" }],
    ["missing version", { ENCRYPTION_KEY: KEY_V1 }],
    ["invalid version", { ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: "abc" }],
    ["zero version", { ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: "0" }],
    ["malformed old key", { ENCRYPTION_KEY: KEY_V1, ENCRYPTION_KEY_VERSION: "2", ENCRYPTION_KEY_V1: "nope" }],
  ])("fails safely on misconfiguration: %s", (_name, badEnv) => {
    let error;
    try {
      encrypt("x", { env: badEnv });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CryptoConfigError);
    expect(error.message).not.toContain(KEY_V1);
    expect(error.message).not.toContain(KEY_V1.slice(0, 62));
  });

  it("never includes key material in decryption errors", () => {
    const { ciphertext } = encrypt("token-value", { env });
    try {
      decrypt(tamper(ciphertext, 3), { env });
    } catch (e) {
      expect(e.message).toBe("Decryption failed");
      expect(e.message).not.toContain(KEY_V1);
    }
  });
});
