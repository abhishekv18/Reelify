# Reelify — Decisions

Source of truth for locked decisions. Changing a locked decision requires explicit approval (CLAUDE.md section 15).

Historical rows are never deleted: superseded or amended decisions keep their original text in the "Decision" column
(struck through where fully replaced) and point to what replaced them.

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| D1 | Billing via **Shopify App Pricing** (hosted plan selection page). No Billing API charge creation. | Locked | Plan-detection method to be verified against current docs on Day 13. |
| D2 | Background jobs via **pg-boss** on the same PostgreSQL database. No Redis. | **Amended 2026-10-13 (D10)** | Still pg-boss, but **inside the web service**, and only if Day 4 confirms it runs reliably there (paid always-on Render instance; risks in `docs/STREAM.md` §7). No encoding jobs any more — only reconcile / delete / prune / scheduled maintenance. Fallback if unreliable: Render Cron Job calling authenticated maintenance scripts. |
| D3 | TikTok removed from v1. | Locked | Official API offers embeds, not video files. |
| D4 | Instagram import behind `FEATURE_INSTAGRAM` (default `false`). App Store submission upload-only unless Meta approval is complete. | Locked | Import mechanism changed to Stream "upload via link" (D10). |
| D5 | ~~Hosting on **Render**: one Web Service + one Background Worker, Docker images with system ffmpeg.~~ | **Amended 2026-10-13 (D10)** | Now: one paid, always-on Render **Web Service**, plain Node image, no ffmpeg, no Background Worker. |
| D6 | Revenue attribution deferred to v1.1. | Locked | No `orders/*` webhooks, no `read_orders`. |
| D7 | v1 storefront = carousel + product-page videos + player. | Locked | |
| D8 | ~~Production media custom domain. All code reads `MEDIA_BASE_URL`; r2.dev allowed for local/dev only.~~ | **Superseded 2026-10-13 (D10)** | Was PENDING. Stream serves playback/thumbnails from `customer-<CODE>.cloudflarestream.com`; no media domain, no `MEDIA_BASE_URL`. |
| D9 | Upload limits: MP4 / MOV / WebM, ≤ 200 MB, ≤ 3 minutes. ~~Output: H.264/AAC MP4, max 720p, `+faststart`.~~ | **Amended 2026-10-13** | Limits made exact: **≤ 200,000,000 bytes**, **≤ 180 s** (`maxDurationSeconds: 180`). Output: **Stream-managed adaptive HLS/DASH**. Actual Stream behaviour at the limits is validated in the Day 3 smoke test. |
| D10 | **Cloudflare Stream** stores, encodes and delivers all videos (replaces R2 + ffmpeg). Basic **Direct Creator Uploads** for v1 (tus later only if needed). Every video `requireSignedURLs: true`; playback only via short-lived tokens signed by our server. | Locked 2026-10-13 | Owner decision. Plan: `docs/STREAM_MIGRATION_PLAN.md`; operations: `docs/STREAM.md`. |
| D11 | MVP playback uses **Cloudflare's embedded Stream player (iframe)**; card previews are **animated thumbnails with static poster fallback**; no autoplaying HLS previews in cards. | Locked 2026-10-13 | Overlay/swipe limitations documented in `docs/STREAM.md` §6 before Day 10. Own player (native HLS + hls.js) may be reconsidered after the MVP. |
| D12 | **Separate Cloudflare account for production.** Dev/staging use a non-production account. | Locked 2026-10-13 | Stream allows one webhook URL per account. |
| D13 | Plan limits cover **video count and stored video minutes**. | Locked 2026-10-13 | Actual numbers decided on Day 13. |

## Day 1 implementation notes (not locked decisions)
- Database: Neon PostgreSQL with Prisma 6.19.3 `url` (pooled) + `directUrl` (direct). SQLite migration history discarded (fresh project, no data); new initial migration `init_postgres_session`.
- Tests: Vitest 3.2.7. `tests/setup.js` replaces `DATABASE_URL`/`DIRECT_URL` with `DATABASE_URL_TEST` and refuses to run if it points at the main database; with no test URL, Prisma is pointed at an unreachable placeholder and DB tests are skipped.
- Scopes: `read_products` only; template demo metafield/metaobject definitions removed.

## Day 2 implementation notes (not locked decisions)
- **Cross-shop guard in the database:** `VideoProduct`, `WidgetVideo` and `Placement` reference their parents through composite
  `(shopId, id)` foreign keys (`Video`/`Widget` have `@@unique([shopId, id])`). Repositories also check ownership first;
  the FKs are the backstop. `Event` deliberately has no FK to `Video`/`Widget` (analytics survive deletes).
- **Webhook idempotency = claim protocol, not a held transaction:** `ProcessedWebhook` has `status` (PROCESSING/COMPLETED),
  `claimToken`, `startedAt` (additions to the PROMPTS field list). INSERT claims the webhook id atomically; duplicates of a
  COMPLETED id → 200 without running; in-flight duplicates → 409 (Shopify retries); failures release the claim → 500;
  claims older than 2 min are taken over. Works through the Neon pooler and with slow handlers. Not linked to `Shop` so
  records survive `shop/redact`.
- **Crypto format:** `v<keyVersion>.<iv>.<tag>.<ciphertext>` (base64url, AES-256-GCM, 12-byte random IV, 16-byte tag),
  optional AAD (use the shopId). Rotation: new `ENCRYPTION_KEY` + bumped `ENCRYPTION_KEY_VERSION`, old key kept as
  `ENCRYPTION_KEY_V<n>`.
- **Shop rows:** created by `afterAuth` (token exchange) and, for already-installed shops, by `getOrCreateShop` in the
  `app.jsx` loader. Uninstall sets `uninstalledAt`; reinstall clears it.
- **Conflict C2 resolved:** webhook `api_version` aligned to `2026-07` (same as `ApiVersion.July26` in `shopify.server.js`).
- **Test DB:** optional `DIRECT_URL_TEST` (direct URL of the test branch) is used for test-branch migrations.

## Day 3 implementation notes (2026-10-14, not locked decisions)
- **Stream client** (`app/services/stream.server.js`): REST over `fetch`, no SDK; uid charset restricted (`[A-Za-z0-9]{1,32}`)
  before any URL is built; errors carry operation, HTTP status, Cloudflare codes and a `retryable` flag only — never the
  token, upload URLs or response bodies.
- **Upload limits are enforced in one short transaction** holding a per-shop advisory lock: lock → one aggregate usage query →
  insert (separate statements so the usage query sees rows committed by the previous lock holder). Transaction limits
  maxWait 10 s / timeout 15 s; a timeout (P2028) becomes a retryable 503 `UPLOAD_BUSY`. Found by the concurrency test
  (the first version made ~6 round trips and timed out under 5 parallel requests against the remote Neon branch).
- **Provisional plan limits** (`app/services/plan.server.js`, until Day 13): 10 active videos, 30 stored minutes (videos
  without a known duration reserve 180 s), 10 uploads in progress.
- **Generic `updateVideo` only edits title/caption**; status and Stream fields change only through the guarded
  `transitionVideoStatus` (forward-only).
- **Private by default is enforced twice:** `requireSignedURLs: true` at creation, and the sync re-enables it if Stream
  ever reports a video as public.
- **Migration `20261014163508_stream_video_fields`** was generated offline with `prisma migrate diff` (HEAD schema → new
  schema, no database contacted) instead of `migrate dev --create-only`, so nothing touched the dev database before the test
  branch passed. It starts with a guard that aborts if any R2 column holds data. Applied: test branch → full suite green →
  dev database (0 Video rows). Applied migrations were not edited.
- **Signed playback**: RS256 JWT built with `node:crypto` (`kid`, `sub`, `exp` ≤ 24 h, `nbf` = now − 60 s); the token
  replaces the uid in iframe / manifest / thumbnail URLs. Verified only with a locally generated RSA key (mocked).

## 2026-10-13 — Media architecture change (R2 + ffmpeg → Cloudflare Stream)
- Owner decision, approved with answers to Q1–Q12 of `docs/STREAM_MIGRATION_PLAN.md` (see D2, D5, D8, D9 amendments and D10–D13).
- Roadmap: the existing Day 0–20 plan is revised in place (no Days 21–29 exist or are invented). Days 1–2 stay complete and unchanged.
- Schema: the four R2 columns (`Video.originalKey/videoKey/previewKey/posterKey`) will be dropped by a **new, reviewed** Day 3
  migration (test branch first); the applied Day 2 migration is not edited. New columns: `streamUid` (unique), `uploadExpiresAt`,
  `streamSyncedAt`, `streamState`; index `(status, updatedAt)`.
- Dependencies: `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (uncommitted, unused by code) are removed with
  `npm uninstall` as the first step of Day 3. No new dependency for Stream (REST via `fetch`, JWT via `node:crypto`).
- Superseded historical notes kept elsewhere: Day 3 R2 plan (presigned PUT, HeadObject, magic-byte check, CORS) and Day 4
  ffmpeg pipeline — replaced by Stream Direct Creator Uploads, webhooks and managed encoding.
