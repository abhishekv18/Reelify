// Real-account Cloudflare Stream smoke test (docs/STREAM.md §10). Never part of `npm test`.
//
//   npm run stream:smoke -- --shop <store>.myshopify.com [--file small.mp4] [--long-file over-3-min.mp4] [--keep]
//
// Runs against the DEV database (DATABASE_URL) and the non-production Stream account in .env.
// Refuses NODE_ENV=production and the test branch. Creates its own videos and deletes them afterwards
// (unless --keep). Prints statuses and codes only — never tokens, upload URLs or signed URLs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "vite";
import { databaseIdentity } from "../tests/helpers/test-env.js";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const results = [];
const record = (check, status, detail = "") => {
  results.push({ check, status, detail });
  console.log(`${status.padEnd(7)} ${check}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
const shopDomain = arg("--shop");
if (env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");
if (!shopDomain || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
  throw new Error("Pass --shop <store>.myshopify.com");
}
const target = databaseIdentity(env.DATABASE_URL);
const testIds = [env.DATABASE_URL_TEST, env.DIRECT_URL_TEST].map(databaseIdentity).filter(Boolean);
if (!target || testIds.includes(target)) throw new Error("DATABASE_URL must be the dev database, not the test branch.");
for (const [k, v] of Object.entries(env)) if (k.startsWith("CLOUDFLARE_") && v) process.env[k] = v;
process.env.DATABASE_URL = env.DATABASE_URL;

const { default: prisma } = await import("../app/db.server.js");
const { getShopByDomain } = await import("../app/repositories/shop.server.js");
const { deleteVideo: deleteRow, getVideo } = await import("../app/repositories/videos.server.js");
const { createStreamClient, readStreamConfig } = await import("../app/services/stream.server.js");
const { createUpload, completeUpload, UploadError } = await import("../app/services/uploads.server.js");
const { readPlaybackConfig, signedMediaUrls, buildMediaUrls } = await import("../app/services/playback.server.js");

const created = []; // { videoId, uid }
let exitCode = 0;

async function uploadFile(shop, filePath, contentType) {
  const stat = fs.statSync(filePath);
  const started = await createUpload(shop, {
    filename: path.basename(filePath),
    contentType,
    sizeBytes: stat.size,
    rightsConfirmed: true,
  }, { stream });
  const row = await getVideo(shop.id, started.videoId);
  created.push({ videoId: started.videoId, uid: row.streamUid });
  const form = new FormData();
  form.append("file", await fs.openAsBlob(filePath), path.basename(filePath));
  const res = await fetch(started.uploadURL, { method: "POST", body: form });
  return { videoId: started.videoId, uploadHttpStatus: res.status, expiresAt: started.expiresAt };
}

async function waitForTerminal(shop, videoId, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last;
  while (Date.now() < until) {
    try {
      last = await completeUpload(shop, videoId, { stream });
      if (last.status === "READY" || last.status === "FAILED") return last;
    } catch (error) {
      if (!(error instanceof UploadError) || error.code !== "UPLOAD_NOT_RECEIVED") throw error;
      last = { status: "UPLOAD_PENDING" };
    }
    await sleep(5000);
  }
  return { ...last, timedOut: true };
}

let stream;
try {
  // 1. Credentials (read-only call)
  try {
    stream = createStreamClient(readStreamConfig(process.env));
    await stream.listVideos({ limit: 1 });
    record("credentials (GET /stream?limit=1)", "PASS");
  } catch (error) {
    record("credentials (GET /stream?limit=1)", "BLOCKED", error.message);
    throw Object.assign(new Error("Stream credentials not usable; remaining checks BLOCKED."), { blocked: true });
  }

  const shop = await getShopByDomain(shopDomain);
  if (!shop) throw new Error(`No Shop row for ${shopDomain} in the dev database. Open the app once first.`);

  // 2. Oversized declaration is rejected before any Stream call
  try {
    await createUpload(shop, { filename: "big.mp4", contentType: "video/mp4", sizeBytes: 200_000_001, rightsConfirmed: true }, { stream });
    record("size > 200,000,000 rejected before Stream", "FAIL", "upload was created");
  } catch (error) {
    record("size > 200,000,000 rejected before Stream", error.code === "TOO_LARGE" ? "PASS" : "FAIL", error.code);
  }

  // 3. Non-video file → INVALID_FILE (ERR_NON_VIDEO expected)
  const textFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reelify-smoke-")), "not-a-video.mp4");
  fs.writeFileSync(textFile, "this is plain text, not a video\n".repeat(64));
  const nonVideo = await uploadFile(shop, textFile, "video/mp4");
  record("non-video: direct upload POST accepted", nonVideo.uploadHttpStatus < 300 ? "PASS" : "INFO", `HTTP ${nonVideo.uploadHttpStatus}`);
  const nonVideoResult = await waitForTerminal(shop, nonVideo.videoId, 3 * 60 * 1000);
  const nonVideoRow = await getVideo(shop.id, nonVideo.videoId);
  record(
    "non-video → FAILED INVALID_FILE",
    nonVideoResult.status === "FAILED" && nonVideoResult.errorCode === "INVALID_FILE" ? "PASS" : "FAIL",
    `status=${nonVideoResult.status} errorCode=${nonVideoResult.errorCode ?? "-"} streamState=${nonVideoRow?.streamState ?? "-"}${nonVideoResult.timedOut ? " (timed out)" : ""}`,
  );

  // 4. Valid video → READY, signed playback
  const file = arg("--file");
  if (!file) {
    record("valid MP4 → READY", "BLOCKED", "no --file given");
  } else {
    const ext = path.extname(file).toLowerCase();
    const type = ext === ".mov" ? "video/quicktime" : ext === ".webm" ? "video/webm" : "video/mp4";
    const valid = await uploadFile(shop, file, type);
    const validResult = await waitForTerminal(shop, valid.videoId, 6 * 60 * 1000);
    const row = await getVideo(shop.id, valid.videoId);
    record(
      "valid video → READY",
      validResult.status === "READY" ? "PASS" : "FAIL",
      `status=${validResult.status} durationMs=${row?.durationMs ?? "-"} ${row?.width ?? "-"}x${row?.height ?? "-"}`,
    );

    if (validResult.status === "READY") {
      let config;
      try {
        config = readPlaybackConfig(process.env);
      } catch (error) {
        record("signed playback", "BLOCKED", error.message);
      }
      if (config) {
        const signed = signedMediaUrls(row, { ttlSeconds: 600, config });
        const unsigned = buildMediaUrls(config.customerCode, row.streamUid);
        for (const [label, url] of [["signed thumbnail.jpg", signed.posterUrl], ["signed thumbnail.gif", signed.previewUrl], ["signed iframe", signed.iframeUrl]]) {
          const r = await fetch(url);
          record(label, r.status === 200 ? "PASS" : "FAIL", `HTTP ${r.status}`);
        }
        const u = await fetch(unsigned.posterUrl);
        record("unsigned thumbnail is refused", u.status === 401 || u.status === 403 ? "PASS" : "FAIL", `HTTP ${u.status}`);
      }
    }
  }

  // 5. Too long → TOO_LONG
  const longFile = arg("--long-file");
  if (!longFile) {
    record("video > 180 s → FAILED TOO_LONG", "BLOCKED", "no --long-file given");
  } else {
    const long = await uploadFile(shop, longFile, "video/mp4");
    const longResult = await waitForTerminal(shop, long.videoId, 6 * 60 * 1000);
    record(
      "video > 180 s → FAILED TOO_LONG",
      longResult.status === "FAILED" && longResult.errorCode === "TOO_LONG" ? "PASS" : "FAIL",
      `status=${longResult.status} errorCode=${longResult.errorCode ?? "-"}`,
    );
  }
} catch (error) {
  if (!error.blocked) {
    exitCode = 1;
    console.error(`Smoke test error: ${error.name}: ${error.message}`);
  } else {
    exitCode = 2;
    console.error(error.message);
  }
} finally {
  if (!args.includes("--keep")) {
    for (const { videoId, uid } of created) {
      try {
        if (uid) await stream.deleteVideo(uid);
        const shop = await getShopByDomain(shopDomain);
        if (shop) await deleteRow(shop.id, videoId);
      } catch (error) {
        console.error(`Cleanup failed for video ${videoId}: ${error.name}`);
        exitCode = exitCode || 1;
      }
    }
    if (created.length) console.log(`Cleaned up ${created.length} smoke-test video(s).`);
  }
  await prisma.$disconnect();
  console.log("\nSummary:");
  console.table(results);
  process.exit(exitCode || (results.some((r) => r.status === "FAIL") ? 1 : 0));
}
