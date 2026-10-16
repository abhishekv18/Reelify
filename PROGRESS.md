# Reelify — Progress

Status legend: ✅ done · 🟡 in progress / partially verified · ⬜ not started

## 20-day plan (from PROMPTS.md — v3, Cloudflare Stream since 2026-10-13)

### Phase A — Core MVP
| Day | Scope | Status |
|-----|-------|--------|
| 1 | Inspect template, PostgreSQL (Neon), Vitest, env example, docs | ✅ |
| 2 | v1 Prisma schema, repositories + tenant isolation, webhook idempotency, crypto, seed | ✅ |
| 3 | Stream client, Direct Creator Upload flow, video sync, R2-column migration *(was: R2 presigned upload — superseded)* | 🟡 code + mocked tests + migration done; real-account smoke test **BLOCKED** (invalid Stream API token) |
| 4 | Stream webhooks, reconciliation, deletion, background jobs *(was: ffmpeg worker pipeline — superseded)* | ⬜ |
| 5 | Videos library and detail UI | ⬜ |
| 6 | Product tagging, products/update + products/delete webhooks | ⬜ |
| 7 | Widgets editor | ⬜ |
| 8 | App Proxy API, theme extension scaffold | ⬜ |
| 9 | Widget runtime + carousel block | ⬜ |
| 10 | Shoppable player + cart | ⬜ |
| 11 | Product videos block, theme deep links, onboarding checklist | ⬜ |
| 12 | Staging deploy + MVP gate | ⬜ |

### Phase B — Launch requirements
| Day | Scope | Status |
|-----|-------|--------|
| 13 | App Pricing, gating, uninstall, compliance webhooks | ⬜ |
| 14 | Event tracking + analytics | ⬜ |
| 15 | Instagram connection (flagged) | ⬜ |
| 16 | Instagram import via Stream upload-by-link (flagged) | ⬜ |

### Phase C — Polish & submit
| Day | Scope | Status |
|-----|-------|--------|
| 17 | Stretch widgets (only if MVP gate + Phase B pass) | ⬜ |
| 18 | Design, accessibility, performance pass | ⬜ |
| 19 | Production deploy (separate Cloudflare production account, D12; D8 superseded) | ⬜ |
| 20 | App Store readiness + submission | ⬜ |

---

## Day 1 — 2026-10-12

### Done
- Inspected template; facts + conflicts (C1–C10) recorded in CLAUDE.md §3.
- Prisma switched to Neon PostgreSQL (`url` pooled + `directUrl` direct). SQLite migration and `prisma/dev.sqlite` removed.
  New migration `20261012120236_init_postgres_session` applied to the Neon main branch (verified empty beforehand with `prisma db pull --print`).
- Scopes → `read_products`; template demo metafield/metaobject definitions and demo product-creation action removed.
- Vitest 3.2.7: `vitest.config.js`, `npm test`, `npm run test:watch`, `npm run test:db:migrate` (guarded, test branch only), `tests/setup.js` (DATABASE_URL_TEST guard), unit test for the guard, DB smoke test.
- `.env.example` (all §12 variables, no values); `.gitignore` now un-ignores `.env.example`; `.env` confirmed ignored.
- `docs/DECISIONS.md` (D1–D9, D8 pending).

### Acceptance criteria
| Criterion | Status |
|-----------|--------|
| App installs on dev store; Session row in Neon | ✅ 2026-10-13: app loads in admin ("Welcome to Reelify"); Neon main has `offline_reelify-testing.myshopify.com` (isOnline=false, scope=read_products, expiring token with refresh token). |
| `npm test` passes | ✅ 5 passed, 0 skipped (after DATABASE_URL_TEST was added on 2026-10-13). |
| CLAUDE.md Template facts + conflicts | ✅ |

### Open items / blockers
- ✅ (resolved 2026-10-13) `DATABASE_URL_TEST` added; DB smoke test runs.
- ✅ (resolved Day 2) Conflict C2: webhook `api_version` aligned to 2026-07.
- `.env` is also missing (expected to be added as needed): `ENCRYPTION_KEY_VERSION`, `OAUTH_STATE_SECRET`, R2_*, `MEDIA_BASE_URL`, FFMPEG/FFPROBE paths.
- Optional: append `&connect_timeout=15` to Neon URLs to tolerate scale-to-zero cold starts (Neon Prisma guide).

## Day 2 — 2026-10-13

Pre-flight checks before planning Day 2:
- ✅ `DATABASE_URL_TEST` now set; guard confirms it is a different database from `DATABASE_URL` / `DIRECT_URL`.
- ✅ `npm test`: 5 passed, 0 skipped (DB smoke test now runs against the test branch).
- ✅ Test branch `prisma migrate status`: up to date (1 migration).
- ✅ `ENCRYPTION_KEY` is 64 hex chars (32 bytes); `OAUTH_STATE_SECRET` differs from it; `ENCRYPTION_KEY_VERSION` is set.
- ✅ Resolved: Day 1 install check now passes (Session row present after opening the app in admin).
- C2 decided: align webhook api_version to 2026-07. Test-DB decision: add optional DIRECT_URL_TEST.

### Done
- Schema: 11 models + 8 enums per CLAUDE.md §6–7 (migration `20261013055713_v1_core_schema`, additive only — reviewed SQL, no DROP, Session untouched).
  Composite `(shopId, id)` FKs on VideoProduct / WidgetVideo / Placement; all tenant tables cascade from Shop; every tenant table has a shopId-first index.
- Repositories: `shop`, `videos`, `videoProducts`, `widgets` (+ widget videos), `placements`, `processedWebhooks`. SocialAccount / OAuthState / Event / RateLimit repositories deferred to Days 14–15 (tables exist).
- Services: `shop.server.js` (`getOrCreateShop`), `webhooks.server.js` (`withIdempotency`), `crypto.server.js` (AES-256-GCM, key versions, AAD).
- Auth wiring: `afterAuth` hook → `getOrCreateShop`; `app.jsx` loader also calls it (afterAuth does not fire for already-installed shops). Both template webhook routes now go through `withIdempotency`; `app/uninstalled` also sets `Shop.uninstalledAt`.
- `app/lib/json.js` (BigInt → string), `app/lib/object.js` (field allow-list), `app/lib/errors.js`.
- `npm run seed` (`prisma/seed.js`) with safety gates; optional `DIRECT_URL_TEST`; Vitest timeouts raised (remote Neon ≈ 250 ms/round trip).
- `shopify.app.toml` webhook `api_version = "2026-07"`.

### Commands run (results)
- `npx prisma format`, `npx prisma validate` → valid.
- `npx prisma migrate dev --name v1_core_schema --create-only`, reviewed SQL, `npx prisma migrate dev` → applied to dev main branch. Client JS/types generated; the query-engine DLL rename failed with EPERM because the running `shopify app dev` holds it (same 6.19.3 engine; restart `shopify app dev` to regenerate cleanly).
- `npm run test:db:migrate` → applied to test branch.
- `npm test` → **8 files, 65 passed, 0 failed, 0 skipped**. (First runs: 5 timeouts at the 5 s default + 22 skipped after a beforeAll timeout, then 1 test bug — fixed.)
- Test-branch leftovers after the run: 0 shops / 0 sessions / 0 webhook rows.
- `npm run seed` refusal paths verified (no --shop, bad domain, unknown shop, NODE_ENV=production, test branch); `npm run seed -- --shop reelify-testing.myshopify.com` twice → same Shop row (dev main branch).
- `npx eslint app tests scripts prisma vitest.config.js` → clean. `npm run build` → OK. Diff scanned for secrets → none.

### Acceptance criteria
| Criterion | Status |
|-----------|--------|
| Migration applies cleanly to the test database | PASS |
| Schema models, relations, indexes, constraints present | PASS |
| Tenant isolation enforced by repositories and proven by tests | PASS (22 tests incl. DB-level FK guard) |
| Webhook idempotency is concurrency-safe | PASS (10 concurrent deliveries → handler ran once) |
| Encryption + tamper detection tests pass | PASS (18 tests) |
| Shopify auth + session storage still functional | PASS — tests (real HMAC + PrismaSessionStorage) and dev store (see below) |
| Complete test suite passes | PASS (65/65) |

### Dev-store verification (2026-10-13)
- First open after the migration failed with `Cannot read properties of undefined (reading 'updateMany')`: stale `shopify app dev` / Prisma Studio processes (Ctrl+C on Windows left them running) served the pre-migration Prisma client and locked the engine DLL. Fixed by stopping those processes, `npx prisma generate`, restarting `shopify app dev`. Lesson: quit the dev server with `q` and close Prisma Studio before migrations.
- ✅ App loads in admin ("Welcome to Reelify"); Session row intact.
- ✅ `Shop` row: `reelify-testing.myshopify.com`, plan `free`, `uninstalledAt` null.
- ✅ `shopify app webhook trigger --topic app/scopes_update --api-version 2026-07 --delivery-method http --address <tunnel>/webhooks/app/scopes_update` → enqueued; `ProcessedWebhook` row APP_SCOPES_UPDATE, COMPLETED, claimToken null (real Shopify HMAC path).
  Note: each CLI trigger uses a new webhook id, so same-id redelivery is covered by the automated tests, not by this check.

### Follow-ups
- Schedule `pruneProcessedWebhooks` (Day 4, pg-boss). Repositories for SocialAccount/OAuthState (Day 15), Event/RateLimit (Day 14).
- `app/uninstalled` keeps shop data until `shop/redact` (Day 13).

## 2026-10-13 — Media architecture change (R2 + ffmpeg → Cloudflare Stream)
- Owner decision: use Cloudflare Stream for storage, encoding and delivery. Full plan, decisions and cost analysis: `docs/STREAM_MIGRATION_PLAN.md`.
- Finding: the roadmap in PROMPTS.md has Day 0 + Days 1–20 (no 29-day version found in the repo or D:\reelify-plan).
- **Approved by the owner** with answers to Q1–Q12 (Day 0–20 kept, signed playback, embedded player, animated-thumbnail previews,
  pg-boss only if reliable in the web service, separate production account, basic uploads ≤ 200,000,000 bytes / ≤ 180 s,
  drop R2 columns via a reviewed migration, Stream-managed HLS/DASH, D8 superseded, remove AWS SDK, limits = count + minutes).
- **Documentation applied:** PROMPTS.md (v3: Days 0, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 16–20 revised; Days 1, 2, 6, 11, 15 byte-identical),
  CLAUDE.md (§1–9, 12, 13; D2/D5/D8/D9 amended, D10–D13 added), DESIGN.md (cards, player, budget), docs/DECISIONS.md (history kept,
  superseded rows struck through), new docs/STREAM.md (setup, embedded-player limitations L1–L8, in-process job risks, runbook,
  open questions).
- `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` (uncommitted in package.json): confirmed unused by any source file; removal with `npm uninstall` is Day 3 step 0 (package changes were out of scope for this documentation phase).
- No application code, packages, schema or database changed. Day 1 and Day 2 remain complete.
- Next: Day 3 starts only after explicit go-ahead. Open technical questions: docs/STREAM.md §12.

## Day 3 — 2026-10-14 — Cloudflare Stream upload flow

### Done
- Removed `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` (`npm uninstall`) after confirming no imports. `package.json` / `package-lock.json` are now identical to commit `f8ea4aa` (those packages were their only uncommitted changes).
- `app/services/stream.server.js` — Stream REST client (direct upload, get/update/delete/list video, create signing key); uid validation; sanitized errors with `retryable`.
- `app/lib/streamStatus.js` — state/error mapping, forward-only transitions. `app/lib/uploads.js` — D9 rules (200,000,000 bytes, 180 s, MP4/MOV/WebM, rights).
- `app/services/videoSync.server.js` — single sync path: ownership check (uid, creator, meta.videoId), re-enables signed URLs, D9 re-check (FAILED + Stream delete), guarded transitions.
- `app/services/uploads.server.js` — createUpload / completeUpload; `app/services/plan.server.js` (provisional limits); `app/services/playback.server.js` (RS256 tokens, iframe/HLS/thumbnail/GIF URLs); `app/services/http.server.js`.
- Routes: `POST /app/api/uploads`, `POST /app/api/uploads/:id/complete` (action-only, `authenticate.admin`, shop from session).
- Repository: `createPendingUpload` (advisory lock + one usage query), `attachStreamUpload`, `transitionVideoStatus`, `getVideoByStreamUid`; `updateVideo` limited to title/caption.
- Migration `20261014163508_stream_video_fields` (drop 4 R2 columns behind a data guard; add streamUid unique, uploadExpiresAt, streamState, streamSyncedAt; index (status, updatedAt)).
- Scripts: `npm run stream:smoke`, `npm run stream:signing-key -- --write-env`. `.env.example`: R2/ffmpeg vars replaced by Stream vars.

### Migration
| Step | Result |
|---|---|
| Generated offline (`prisma migrate diff`, HEAD schema → new schema) | no database contacted; SQL reviewed and approved by owner |
| Applied to **test branch** (`npm run test:db:migrate`) | ✅ applied |
| Full suite on test branch | ✅ 160/160 |
| Applied to **dev database** (`prisma migrate deploy`; 0 Video rows beforehand) | ✅ applied; `migrate status`: up to date (3 migrations) |

### Tests (mocked Stream API + Neon test branch)
- `npm test`: **14 files, 160 passed, 0 failed, 0 skipped** (Day 1–2: 65 tests, unchanged and passing; Day 3: +95).
- New: `unit/uploads-lib` (22), `unit/stream-status` (18), `unit/stream-client` (12), `unit/playback` (7), `integration/uploads` (27), `integration/upload-routes` (9).
- Bugs found by the tests and fixed: (1) `deleteVideo` reported a successful delete (`result: null`) as "already gone"; (2) invalid uids threw synchronously instead of rejecting; (3) upload transactions timed out (P2028) under 5 parallel requests → fewer round trips, explicit tx limits, 503 `UPLOAD_BUSY`.
- `npx eslint app tests scripts prisma vitest.config.js` → clean. `npm run build` → OK; client bundle contains no `CLOUDFLARE_`, API host, signing-key or `stream.server` references.

### Real-account checks — BLOCKED
- `CLOUDFLARE_STREAM_API_TOKEN` is rejected by Cloudflare: Stream list API → HTTP 401 code 10000; `/user/tokens/verify` and `/accounts/{id}/tokens/verify` → 401 code 1000 ("invalid API token"). Account id and customer code parse correctly.
- `npm run stream:smoke -- --shop reelify-testing.myshopify.com` → stops at the credential check (BLOCKED), creates nothing.
- Not verified for real (do not treat as passed): direct upload creation, `expiry` handling, multipart upload, non-video → `ERR_NON_VIDEO`, > 180 s → `ERR_DURATION_EXCEED_CONSTRAINT`, READY metadata, signed thumbnail/GIF/iframe URLs, unsigned URL refusal, signing-key creation.

### Real-account results (2026-10-14, after a new token)
| Check | Result |
|---|---|
| Token valid (`/user/tokens/verify`) | ✅ HTTP 200, `active` (user token; account-token verify 401/1000 is expected) |
| Stream read on CLOUDFLARE_ACCOUNT_ID (`GET /stream`) | ✅ HTTP 200 |
| Stream Edit permission | ✅ proven by `npm run stream:signing-key -- --write-env` (run by owner; key loads as RSA-2048) |
| Size > 200,000,000 rejected before Stream | ✅ PASS (`TOO_LARGE`, no Stream call) |
| Direct upload creation | ❌ **HTTP 413, Cloudflare code 10011** — `GET /stream/storage-usage` shows `totalStorageMinutesLimit: 0`: **no Stream storage capacity purchased**. App behaved correctly: sanitized log (status + code), 502 to the client, row deleted (0 Video rows, 0 Stream videos afterwards). |
| Non-video → INVALID_FILE, valid video → READY, signed thumbnail/GIF/iframe, unsigned refused, > 180 s → TOO_LONG | ⛔ **BLOCKED** until storage capacity is purchased (and `--file` / `--long-file` are supplied) |

### To unblock (you)
0. Buy Stream storage capacity on the non-production account (Dashboard → Stream → plans; $5 / month per 1,000 minutes). Without it every direct upload is refused (413 / 10011).

1. Create a new API token: Account › Stream › Edit for this account only (docs/STREAM.md §3); put it in `.env` as `CLOUDFLARE_STREAM_API_TOKEN`.
2. `npm run stream:signing-key -- --write-env`
3. `npm run stream:smoke -- --shop reelify-testing.myshopify.com --file <small.mp4> [--long-file <over-3-min.mp4>]`

### Follow-ups
- Day 4: Stream webhook, reconciler (expired `UPLOAD_PENDING` + placeholders), `stream-delete` job with retries (the D9-rejection delete is best-effort today), `DELETE /app/api/videos/:id`.
- No admin UI calls these APIs yet (Day 5).
