// Creates a Cloudflare Stream signing key (POST /stream/keys) and stores it in .env.
// Usage: npm run stream:signing-key -- --write-env
//
// Cloudflare returns the private key only once, so this script refuses to run unless it can save it
// (--write-env), and it never prints the key. It also refuses if .env already has a signing key.
// Docs: https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/
import fs from "node:fs";
import { loadEnv } from "vite";
import { createStreamClient, readStreamConfig } from "../app/services/stream.server.js";

const ENV_FILE = ".env";

function fail(message) {
  console.error(`stream:signing-key: ${message}`);
  process.exit(1);
}

if (!process.argv.includes("--write-env")) {
  fail("re-run with --write-env. The private key is shown only once, so it must be saved straight into .env.");
}

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
if (env.NODE_ENV === "production") fail("refusing to run with NODE_ENV=production; set production keys in Render.");
if (env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK) {
  fail("a signing key is already configured in .env. Remove both variables first if you really want a new key.");
}

let config;
try {
  config = readStreamConfig(env);
} catch (error) {
  fail(error.message);
}

let key;
try {
  key = await createStreamClient(config).createSigningKey();
} catch (error) {
  fail(`${error.message}. Check CLOUDFLARE_STREAM_API_TOKEN (Account › Stream › Edit).`);
}
if (!key?.id || !key?.jwk) fail("unexpected response from Cloudflare (no key id / jwk).");

const existing = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
const eol = existing.includes("\r\n") ? "\r\n" : "\n";
const prefix = existing === "" || existing.endsWith("\n") ? "" : eol;
fs.appendFileSync(
  ENV_FILE,
  `${prefix}CLOUDFLARE_STREAM_SIGNING_KEY_ID=${key.id}${eol}CLOUDFLARE_STREAM_SIGNING_KEY_JWK=${key.jwk}${eol}`,
);
console.log(`Signing key ${key.id} created and saved to ${ENV_FILE} (private key not printed).`);
