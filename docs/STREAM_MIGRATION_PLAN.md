# Reelify — Migration plan: Cloudflare R2 + ffmpeg → Cloudflare Stream

Status: **APPROVED 2026-10-13 with changes** — documentation applied (PROMPTS.md v3, CLAUDE.md, DESIGN.md,
docs/DECISIONS.md, PROGRESS.md, new docs/STREAM.md). Day 3 implementation waits for an explicit go-ahead.

**Approval record (owner answers to §9):** Q1 revise Day 0–20, no Days 21–29 · Q2 signed playback, private by default ·
**Q3 changed: start with Cloudflare's embedded player** (overlay/swipe limitations documented in `docs/STREAM.md` §6) — the
own-`<video>` + hls.js proposal below is *superseded* for the MVP · Q4 animated thumbnails + static poster fallback, no HLS
autoplay in cards · **Q5 changed: keep pg-boss only if it runs reliably in the chosen hosting** (risks + Cron Job fallback in
`docs/STREAM.md` §7) · Q6 separate production account · Q7 basic Direct Creator Uploads, ≤ 200,000,000 bytes, ≤ 180 s, real
behaviour validated in the smoke test · Q8 drop the four R2 columns via a reviewed new migration (test branch first; applied
migrations never edited) · Q9 Stream-managed adaptive HLS/DASH · Q10 D8 superseded · Q11 `npm uninstall` the AWS SDK packages
after confirming they are unused (done as Day 3 step 0) · Q12 limits = video count + stored minutes, numbers on Day 13.
Where this proposal differs from the approved answers (Day 8 `hlsUrl`, Day 10 own player/hls.js), PROMPTS.md v3 is authoritative.

Sources (official Cloudflare docs, read 2026-10-13):
[Direct Creator Uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/) ·
[direct_upload API](https://developers.cloudflare.com/api/resources/stream/subresources/direct_upload/methods/create/) ·
[Webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/) ·
[Securing your Stream (signed URLs)](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/) ·
[Own player / manifests](https://developers.cloudflare.com/stream/viewing-videos/using-own-player/) ·
[Thumbnails](https://developers.cloudflare.com/stream/viewing-videos/displaying-thumbnails/) ·
[Upload via link](https://developers.cloudflare.com/stream/uploading-videos/upload-via-link/) ·
[Supported inputs](https://developers.cloudflare.com/stream/uploading-videos/) ·
[List videos API](https://developers.cloudflare.com/api/resources/stream/methods/list/) ·
[Delete video API](https://developers.cloudflare.com/api/resources/stream/methods/delete/) ·
[Pricing](https://developers.cloudflare.com/stream/pricing/)

---

## 0. Findings from inspection

| Finding | Detail |
|---|---|
| **No 29-day plan exists** | `PROMPTS.md` (repo) and the original copy in `D:\reelify-plan\PROMPTS.md` are identical: **Day 0 (manual) + Days 1–20** in phases A (1–12), B (13–16), C (17–20). No file in the repo or `D:\reelify-plan` mentions Days 21–29. This plan revises the 21 entries that exist and keeps their numbers. If a 29-day version exists elsewhere, share it and I will re-map. |
| Git | Branch `main`, last commit `f8ea4aa add` (Day 1 + Day 2). Uncommitted: `package.json` / `package-lock.json` add **`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`** (not added by me; presumably installed after the R2 Day 3 plan). They become obsolete — see decision Q11. |
| R2-specific code that exists today | Only schema columns `Video.originalKey / videoKey / previewKey / posterKey` (migration `20261013055713_v1_core_schema`) and their names in the `WRITABLE_FIELDS` allow-list of `app/repositories/videos.server.js`. **0 Video rows** in the dev branch (checked read-only); none in the test branch after test cleanup. No R2/S3/ffmpeg service code was written (Day 3 was only planned). |
| R2-specific docs | `CLAUDE.md` (§2 D5/D8/D9, §3 stack rows, §4 diagram, §5 `worker/`, §7 lifecycle, §8 uploads, §12 env, §13 `npm run worker`), `PROMPTS.md` (Days 0, 3, 4, 5, 8, 9, 10, 12, 13, 16, 18, 19, 20), `DESIGN.md` (card previews, player, perf), `docs/DECISIONS.md` (D2/D5/D8/D9), `.env.example` (`R2_*`, `MEDIA_BASE_URL`, `FFMPEG_PATH`, `FFPROBE_PATH`), `PROGRESS.md` (Day 3/4 rows). |
| Completed work unaffected | Day 1 (Postgres/Neon, Vitest, env guard) and Day 2 (schema, tenant isolation, composite FKs, webhook idempotency, crypto, seed) do not depend on storage. Nothing is deleted or rewritten; applied migrations stay untouched. |

---

## 1. Revised roadmap (Day 0 + Days 1–20, numbers unchanged)

Legend: ✅ done · 🔁 rewritten for Stream · ✏️ amended · = unchanged

| Day | Title (revised) | Change |
|---|---|---|
| 0 | Manual setup (you) | ✏️ R2 bucket → Cloudflare Stream subscription, API token, signing key, customer code |
| 1 | Inspect, foundation, PostgreSQL, tests | ✅ = (historical) |
| 2 | Schema, tenant isolation, idempotency | ✅ = (historical; R2 columns superseded by Day 3 migration) |
| 3 | **Stream client, Direct Creator Upload flow, video sync** | 🔁 was "R2 storage + presigned PUT" |
| 4 | **Stream webhooks, reconciliation, deletion, background jobs** | 🔁 was "ffmpeg worker + processing pipeline" |
| 5 | Videos library and detail UI | ✏️ multipart POST to Stream upload URL; signed thumbnails; Stream player in admin |
| 6 | Product tagging and product webhooks | = |
| 7 | Widgets editor | ✏️ minor (signed thumbnails in pickers) |
| 8 | App Proxy API and extension scaffold | ✏️ responses carry signed playback/poster URLs instead of MEDIA_BASE_URL URLs |
| 9 | Widget runtime and carousel block | ✏️ poster-first cards; preview strategy per Q4; no HLS in cards |
| 10 | Shoppable player and cart | ✏️ HLS playback (Q3), token expiry handling, cost-aware preloading |
| 11 | Product videos block and theme deep links | = |
| 12 | Staging deploy and MVP gate | ✏️ no ffmpeg image; jobs per Q5; staging Stream account/webhook; revised MVP gate |
| 13 | App Pricing, gating, uninstall, compliance | ✏️ limits in stored minutes; `shop/redact` deletes Stream videos |
| 14 | Event tracking and analytics | ✏️ minor (cost monitoring hook) |
| 15 | Instagram connection (flagged) | = |
| 16 | Instagram import (flagged) | 🔁 Stream "upload via link" (`/stream/copy`) instead of worker download |
| 17 | Stretch widgets | ✏️ bubble/stories use poster/animated thumbnail + shared player |
| 18 | Design, accessibility, performance pass | ✏️ adds delivered-minutes cost audit |
| 19 | Production deploy | 🔁 Stream prod account/token/signing key/webhook, storage capacity + monitoring; D8 domain work removed |
| 20 | App Store readiness and submission | ✏️ privacy policy names Cloudflare Stream; deletion covers Stream |

No reordering is required. Day 3 and Day 4 are both rewritten but keep their place: Day 3 = create/complete/sync
(everything needed to get a video to READY by polling), Day 4 = webhooks, reconciliation, deletion, jobs.

### Revised day prompts (to replace the corresponding blocks in PROMPTS.md on approval)

**Day 0 — Manual setup (amended items only)**
- Replace "Cloudflare R2 bucket `reelify-videos` + API token … Enable r2.dev" with:
  - Cloudflare account(s) with **Stream** enabled and prepaid storage capacity purchased (Q6: separate account for production).
  - API token: **Account → Stream → Edit** (covers Stream Read + Write), restricted to that one account. Save as `CLOUDFLARE_STREAM_API_TOKEN`; save the account id as `CLOUDFLARE_ACCOUNT_ID`.
  - Customer subdomain code (`customer-<CODE>.cloudflarestream.com`, visible in the Stream dashboard) → `CLOUDFLARE_STREAM_CUSTOMER_CODE`.
  - Signing key and webhook secret are created on Day 3/4 by scripts (they are shown once).
- Remove ffmpeg/r2.dev mentions. D8 note becomes "superseded" (§9).

**Day 3 — Stream client, Direct Creator Upload flow, video sync [PLAN]**
1. `app/services/stream.server.js`: minimal Cloudflare Stream REST client on `fetch` (no new dependency) with an injectable `fetch` for tests: `createDirectUpload({ maxDurationSeconds, expiry, creator, meta, requireSignedURLs, thumbnailTimestampPct })`, `getVideo(uid)`, `deleteVideo(uid)` (404 = already gone), `listVideos({ creator, status, before, limit })`. Base `https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/stream`, `Authorization: Bearer` token. Errors never include the token, upload URLs or response bodies with URLs; config read lazily (`StreamConfigError` names the variable only).
2. Migration `stream_video_fields` (see §6) — test branch first.
3. `app/lib/streamStatus.js` (pure): Stream state → our status; Stream error codes → our `errorCode`; forward-only transition rules (READY/FAILED are terminal; never move backwards).
4. `app/services/videoSync.server.js`: `syncVideoFromStream(shopId, videoId, { details? })` — the single code path used by `/complete`, webhooks (Day 4) and reconciliation (Day 4). Verifies `details.uid === video.streamUid`, `details.creator === shopId` and `details.meta.videoId === video.id` before applying anything; applies the transition with an `updateMany` guarded by `{ id, shopId, status ∈ allowedFrom }`; stores `durationMs`, `width`, `height`, `sizeBytes`, `streamState`, `streamSyncedAt`; enforces D9 again (duration > 180 s or size > limit → FAILED and Stream video deleted).
5. `POST /app/api/uploads` (authenticate.admin; shop from session): validate `{ filename, contentType, sizeBytes, rightsConfirmed }` (MP4/MOV/WebM, 1 B–200,000,000 B, rights `true`), plan limit + pending-upload cap inside one transaction with a per-shop advisory lock (stub `plan.server.js`: free = 10 videos), create `Video` (`UPLOAD_PENDING`), call `createDirectUpload` with `maxDurationSeconds: 180`, `expiry: now + 30 min`, `requireSignedURLs: true` (Q2), `creator: shopId`, `meta: { app: "reelify", shopId, videoId, env }`, store `streamUid` + `uploadExpiresAt`, return `{ videoId, uploadURL, expiresAt }`. If the Stream call fails → delete the just-created row and return 502 with a plain message. **The one-time `uploadURL` is never logged.**
6. `POST /app/api/uploads/:id/complete` (hint from the browser after its upload finished): load by `(id, shopId)` (404 otherwise), never accept a uid from the client, `getVideo(video.streamUid)` → `syncVideoFromStream`. `pendingupload` → 409 `UPLOAD_NOT_RECEIVED` (row stays pending). Idempotent: repeated or concurrent calls converge on one state.
7. `app/services/playback.server.js`: signed-token helper (RS256 JWT built with `node:crypto`, `kid`, `sub = uid`, `exp ≤ 24 h`, optional `nbf`) and URL builders for HLS manifest, iframe and thumbnail using `CLOUDFLARE_STREAM_CUSTOMER_CODE`; `scripts/stream-create-signing-key.js` (one-time, prints only the instructions; writes key material to `.env` only with explicit `--write-env`).
8. Delete the obsolete R2 env vars from `.env.example`; add the Stream ones (§5). Uninstall the AWS SDK packages (Q11).
Tests (mocked Stream API, test DB): validation rejections; plan limit + concurrency (8 existing, 5 parallel creates → 2 succeed); direct-upload request body (`maxDurationSeconds: 180`, `requireSignedURLs: true`, `creator`, `meta`, `expiry`); Stream failure → no row left; complete for each Stream state (`pendingupload`, `queued`, `inprogress`, `ready`, `error` with each code); cross-shop complete → 404 and no Stream call; creator/meta mismatch → rejected and flagged; concurrent completes converge; JWT verifies with the public key, `exp` ≤ 24 h, `kid` set; no token/upload URL in logs or error messages.
Acceptance: real smoke (`npm run stream:smoke -- --shop … --file small.mp4`): upload via the one-time URL → `/complete` → READY (polling) with duration/dimensions stored; signed thumbnail URL returns 200, unsigned returns 401/403; a renamed `.txt` ends FAILED `INVALID_FILE` (`ERR_NON_VIDEO`); a > 3-minute clip ends FAILED `TOO_LONG` (`ERR_DURATION_EXCEED_CONSTRAINT`); the script deletes its Stream videos and rows. End with the Report.

**Day 4 — Stream webhooks, reconciliation, deletion, background jobs [PLAN]**
1. `POST /webhooks/stream` (no Shopify auth): verify `Webhook-Signature` (`time=…,sig1=…`; HMAC-SHA256 over `time + "." + rawBody` with `CLOUDFLARE_STREAM_WEBHOOK_SECRET`; constant-time compare; reject timestamps older than 5 min or > 1 min in the future) → 401 on failure. Look up `Video` by unique `streamUid` (documented system lookup), then **re-fetch `getVideo(uid)`** and run `syncVideoFromStream` (payload is a trigger, the API is the source of truth — protects against replayed old payloads). Unknown uid → 200 + warning (no retry storm). Idempotent by forward-only transitions; record deliveries in `ProcessedWebhook` keyed `stream:<uid>:<state>` to short-circuit duplicates.
2. `scripts/stream-webhook.js set --url <public-url>` (one webhook URL per Cloudflare account; prints that the returned secret must be stored as `CLOUDFLARE_STREAM_WEBHOOK_SECRET`, never echoes it unless `--write-env`).
3. Background jobs (Q5, recommended: pg-boss inside the web process, no separate worker): `stream-reconcile` every 5 min — `UPLOAD_PENDING` past `uploadExpiresAt + 10 min` → `getVideo`; if still `pendingupload`/404 → delete the Stream placeholder and the row; `UPLOADED`/`PROCESSING` not synced for 10 min → sync. `stream-delete` (retry 5×, exponential backoff, 404 = done) — always re-checks `details.creator === shopId` before deleting. `prune-processed-webhooks` daily (> 30 days, reuses Day 2 `pruneProcessedWebhooks`).
4. `DELETE /app/api/videos/:id` (authenticate.admin): delete the row by `(id, shopId)` (tags/widget links cascade) and enqueue `stream-delete { shopId, uid }`. Cancelled uploads use the same path.
5. Retry semantics: Stream cannot re-encode a failed upload → FAILED uploads offer "Upload again" (new video). `SOURCE_UNAVAILABLE` (Instagram, Day 16) offers "Retry import".
Tests: signature valid / wrong secret / tampered body / stale or future timestamp / malformed header; replayed `ready` → no double transition; out-of-order (`ready` then older `inprogress`) → stays READY; unknown uid → 200, no DB change; webhook for uid whose details creator ≠ row shopId → no change + error log; reconciler: expired pending removed (Stream delete called with the stored uid only), stuck processing synced, rows of other shops untouched; delete job never deletes a uid whose creator differs; prune.
Acceptance: real upload in dev reaches READY via the webhook through the tunnel; with webhooks disabled the reconciler reaches READY within one interval; deleting a video removes it from Stream (verified with `getVideo` → 404). End with the Report.

**Day 5 — Videos library and detail UI (amended items)**
- Upload queue: `XMLHttpRequest` **multipart POST** (field `file`) to the one-time `uploadURL` (upload progress via `xhr.upload.onprogress`), then `/complete`; cancel = abort XHR + `DELETE /app/api/videos/:id`; retry = new upload. Max 3 parallel. No custom headers, no PUT.
- Cards and detail use **signed thumbnail URLs** from the loader (token TTL ≈ 1 h); detail page plays through the **Stream player iframe** with a signed token (admin is not bound by the storefront JS budget).
- Poll every 5 s only while any video is `UPLOAD_PENDING/UPLOADED/PROCESSING`; each poll is a DB read (Stream sync happens via webhook/reconciler, not per poll).
- Error copy per `errorCode` including Stream reasons (not a video, too long, corrupt file, processing failed).
Tests: loader/action scoping; delete enqueues `stream-delete` with the stored uid; tokens only generated for the shop's own videos. Acceptance unchanged + works at mobile width.

**Day 7 — Widgets editor (amended)**: video picker and widget preview use signed thumbnails; only READY videos are attachable. Rest unchanged.

**Day 8 — App Proxy API (amended)**: widget/product-videos responses return, per READY video: `id`, `title`, `width`, `height`, `durationMs`, `posterUrl` (signed thumbnail), `hlsUrl` (signed manifest), `previewUrl` (signed animated thumbnail or `null`, per Q4), product handles. Tokens: `exp` = 6 h; responses `Cache-Control: public, max-age=60`. Never return the API token, raw uid-only URLs (they would fail for signed videos) or non-READY videos. Tests add: every URL is signed, tokens expire ≤ 24 h, other shops' widgets → 404.

**Day 9 — Widget runtime and carousel block (amended)**: cards are poster-first (signed thumbnail, `width`/`height` → `aspect-ratio`); preview behaviour per Q4 (default proposal: animated thumbnail only while ≥ 50 % visible, max 2 at once, disabled under reduced motion and Save-Data); **no HLS in cards** (cost and budget). Budgets unchanged.

**Day 10 — Shoppable player and cart (amended)**: playback per Q3 (proposal: own `<video>`; native HLS where `canPlayType('application/vnd.apple.mpegurl')`, otherwise lazy-load a vendored `hls.js` light build as a separate theme-extension asset only when the player opens — excluded from the 25 KB initial budget and reported separately). Preload only the next video's manifest (not segments) to limit billed delivery; on 401/403 refetch fresh signed URLs from the proxy. Cart behaviour unchanged.

**Day 12 — Staging deploy and MVP gate (amended)**: Dockerfile without ffmpeg; one Render Web Service running pg-boss in-process (Q5) — no Background Worker unless Q5 says otherwise; staging Cloudflare account (or the dev one, Q6) with its own webhook URL and signing key; `/healthz` also checks Stream API reachability (cached). MVP gate: "valid → READY via Stream; invalid → correct FAILED code; webhook + reconciler both converge; deletes remove Stream videos; tenant isolation, upload validation, webhook idempotency (Shopify + Stream) tests pass".

**Day 13 — Pricing, gating, uninstall, compliance (amended)**: plan limits expressed as video count **and** total stored minutes (e.g. free 10 videos / 30 min; paid caps to be set — unlimited storage is a direct cost to us); `shop/redact` deletes all of the shop's rows and enqueues `stream-delete` for every stored uid **plus** a sweep `listVideos({ creator: shopId })` for orphans; `app/uninstalled` unchanged (data kept until redact). Tests: redact enqueues deletes only for that shop's uids/creator.

**Day 14 — Analytics (amended)**: unchanged event model; add an internal daily log of Stream storage usage (`GET …/stream/storage-usage` — verify endpoint on the day) for cost monitoring; no merchant-facing change.

**Day 16 — Instagram import (rewritten)**: for each selected media, fetch a fresh `media_url` at import time; missing → FAILED `COPYRIGHT_RESTRICTED` (no Stream call). Otherwise `POST /stream/copy` with `url`, `creator: shopId`, `meta`, `requireSignedURLs: true` (verify which fields `copy` accepts on the day) → store `streamUid`, status `UPLOADED`; webhooks/reconciler finish it. `ERR_FETCH_ORIGIN_ERROR` → `SOURCE_UNAVAILABLE` with "Retry import" (re-fetch `media_url`, new copy). Duration > 180 s after processing → FAILED `TOO_LONG` + Stream delete. Batch ≤ 10 per request (no worker needed). Expired IG token → `needsReconnect`.

**Day 17 — Stretch widgets (amended)**: bubble/stories use poster or animated thumbnail; playback only in the shared player.

**Day 18 — Design/a11y/perf pass (amended)**: add a cost audit: measure delivered minutes per storefront session (DevTools: count segment requests) with and without previews; report hls.js lazy chunk size separately.

**Day 19 — Production deploy (rewritten media part)**: production Cloudflare account/token/customer code/signing key/webhook (`scripts/stream-webhook.js set --url https://<prod>/webhooks/stream`); purchase storage capacity sized from §8; monitor storage usage (alert at 80 %) because exhausted capacity blocks **all** uploads; Sentry, `/healthz`. All R2 custom-domain, CORS, cache-header and r2.dev steps removed (D8 superseded).

**Day 20 — App Store readiness (amended)**: privacy policy lists Cloudflare Stream as the video storage/delivery sub-processor; reviewer instructions mention processing time after upload; deletion on uninstall/redact covers Stream.

Days 6, 11 and 15 are unchanged.

---

## 2. Completed days that remain unchanged

- **Day 1** — PostgreSQL/Neon, scopes, Vitest + test-DB guard, `.env.example`, docs. Only `.env.example` R2/ffmpeg lines are replaced as part of Day 3 (not a rewrite of Day 1).
- **Day 2** — schema, repositories, tenant isolation, composite FKs, webhook idempotency, crypto, seed, all 65 tests. The four R2 key columns are superseded by the Day 3 migration (additive change + optional drop, Q8); the applied Day 2 migration is not edited.
- Status markers ✅ for Days 1–2 stay as they are in `PROGRESS.md`.

---

## 3. Files to update and why (applied after approval)

| File | Change |
|---|---|
| `PROMPTS.md` | Replace Day 0 media bullet and the Day 3, 4, 16, 19 blocks; amend Days 5, 7, 8, 9, 10, 12, 13, 14, 17, 18, 20 per §1; add a header note "Media: Cloudflare Stream (D10, 2026-10-13)". Days 1, 2, 6, 11, 15 untouched. |
| `CLAUDE.md` | §1 "background processing pipeline" → "Cloudflare Stream upload + processing"; §2 add **D10** and mark D2/D5/D8/D9 as amended/superseded (history kept); §3 Media storage / Processing / Jobs rows; §4 diagram (Stream instead of R2 + worker); §5 `worker/` → `app/jobs/` (Q5); §7 lifecycle (mapping table in §4 below); §8 uploads + new "Stream webhooks" + "Signed playback" rules; §9 video bullets (poster-first, HLS, cost-aware preload); §12 env vars; §13 commands (`stream:smoke`, `stream:webhook`, remove `npm run worker` if Q5 = in-process). |
| `DESIGN.md` | Video card: preview = animated thumbnail (or none) instead of muted MP4; player: HLS + token refresh, video error states; performance budget: hls.js lazy asset reported separately; admin detail uses Stream player. |
| `docs/DECISIONS.md` | Add D10 (Stream) with sources; mark D2, D5, D8, D9 rows "amended by D10" with the old text preserved; record Q-answers. |
| `PROGRESS.md` | Plan table titles for Days 3, 4, 16, 19; note the migration; Day 3 = pending approval. |
| `.env.example` (Day 3) | Remove `R2_*`, `MEDIA_BASE_URL`, `FFMPEG_PATH`, `FFPROBE_PATH`; add Stream vars (§5). |
| `package.json` (Day 3) | Remove `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (Q11); add scripts `stream:smoke`, `stream:webhook`, `stream:signing-key`. |
| `prisma/schema.prisma` + new migration (Day 3) | §6. |
| `app/repositories/videos.server.js` (Day 3) | Replace R2 key names in `WRITABLE_FIELDS` with Stream fields; add `getVideoByStreamUid` (system lookup) and guarded transition helper. |
| New docs | `docs/STREAM.md` (setup + runbook: tokens, signing key rotation, webhook re-registration, storage capacity, smoke tests). Replaces the planned R2 `docs/SETUP.md`. |

---

## 4. Architecture and flows

```
Admin (iframe, App Bridge)                         Storefront (theme app extension)
  │ 1 POST /app/api/uploads ───────────┐             │ GET /apps/reelify/* (app proxy, HMAC verified)
  │ 2 multipart POST file ─────────────┼──► Cloudflare Stream (one-time uploadURL; API token never in browser)
  │ 3 POST /app/api/uploads/:id/complete│             ▲ signed HLS / thumbnail URLs (RS256 JWT, exp ≤ 24 h)
  ▼                                     ▼             │
React Router app (Render) ── Stream REST API (Bearer token, server only)
  ├─ uploads/complete → syncVideoFromStream ◄── POST /webhooks/stream (HMAC Webhook-Signature)
  ├─ jobs (pg-boss): stream-reconcile, stream-delete, prune
  └─ repositories (shop-scoped) ──► Neon PostgreSQL (Video.streamUid unique)
```

**Status mapping (our `Video.status` ← Stream `status.state`)**

| Stream | Ours | Notes |
|---|---|---|
| (upload URL issued) `pendingupload` | `UPLOAD_PENDING` | row created before the Stream call; `uploadExpiresAt` stored |
| `downloading`, `queued` | `UPLOADED` | file received (or being fetched for Instagram) |
| `inprogress` | `PROCESSING` | |
| `ready` **and** `readyToStream: true` | `READY` | only status ever exposed to the storefront |
| `error` | `FAILED` | `ERR_NON_VIDEO`, `ERR_MALFORMED_VIDEO`, `ERR_DURATION_TOO_SHORT` → `INVALID_FILE`; `ERR_DURATION_EXCEED_CONSTRAINT` → `TOO_LONG`; `ERR_FETCH_ORIGIN_ERROR` → `SOURCE_UNAVAILABLE`; `ERR_UNKNOWN` → `TRANSCODE_ERROR` (meaning "processing failed") |
| upload URL expired without file | row + placeholder deleted by reconciler | matches the old "delete UPLOAD_PENDING after 24 h" rule, now after expiry + 10 min |
| our checks (size/type before URL; duration/size after processing) | `FAILED TOO_LARGE / TOO_LONG / INVALID_FILE` | Stream video deleted |

Transitions are forward-only (`UPLOAD_PENDING → UPLOADED → PROCESSING → READY|FAILED`, skipping allowed); READY and FAILED are terminal, so duplicate or out-of-order webhooks cannot regress a video.

**Security controls**
- Shop always from `authenticate.admin` / `authenticate.public.appProxy`; client-supplied shop ids, Stream uids or URLs are never used.
- Upload URL is generated server-side per request, one-time, expires in 30 min, carries `maxDurationSeconds: 180`; basic uploads are capped at 200 MB by Stream itself, matching D9 (Q7). Stream rejects non-video input (`ERR_NON_VIDEO`).
- Ownership is checked twice: our `(id, shopId)` lookup **and** Stream's `creator === shopId` / `meta.videoId === id` before any transition or deletion.
- `streamUid` is globally unique in the DB; webhook lookup by uid is the only unscoped read and is followed by the creator/meta check.
- Videos are created with `requireSignedURLs: true` (Q2); admin and storefront get short-lived tokens signed locally with the Stream signing key (no per-token API call, not rate-limited). `allowedOrigins` left empty (any) because storefront custom domains change; signed tokens are the control.
- Secrets (API token, signing key, webhook secret) are server-only env vars, never logged; logs never contain upload URLs, tokens or signed URLs (only video id, uid, state).

---

## 5. Environment variables and Cloudflare permissions

| Variable | Secret? | Purpose |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | no | API base path |
| `CLOUDFLARE_STREAM_API_TOKEN` | **yes** | Bearer token; permission **Account › Stream › Edit** (includes Read), scoped to this account only. One token per environment. |
| `CLOUDFLARE_STREAM_CUSTOMER_CODE` | no | `customer-<CODE>.cloudflarestream.com` for manifest/iframe/thumbnail URLs |
| `CLOUDFLARE_STREAM_SIGNING_KEY_ID` | no | JWT `kid` (required if Q2 = signed playback) |
| `CLOUDFLARE_STREAM_SIGNING_KEY_JWK` | **yes** | base64 JWK private key from `POST /stream/keys` (shown once) |
| `CLOUDFLARE_STREAM_WEBHOOK_SECRET` | **yes** | from `PUT /stream/webhook`; verifies `Webhook-Signature` |

Removed: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `MEDIA_BASE_URL`, `FFMPEG_PATH`, `FFPROBE_PATH`.
No value is invented; you create them on Day 0 / Day 3 / Day 4.

---

## 6. Database migration assessment

Current `Video` (Day 2): `status`, `source`, `externalId`, `title`, `caption`, `originalKey`, `videoKey`, `previewKey`,
`posterKey`, `mimeType`, `sizeBytes Int?`, `width`, `height`, `durationMs`, `errorCode`, `errorMessage`, `attempts`,
`rightsConfirmedAt`, timestamps. Enums `VideoStatus` and `VideoErrorCode` already cover every Stream outcome (§4) — **no enum change needed**.

| Need | Existing field? | Proposal |
|---|---|---|
| Stream UID (webhook lookup, API calls) | no (`originalKey` is a free string, but not unique and misnamed) | **add `streamUid String? @unique`** (max 32 chars) |
| Upload URL expiry (reconciler) | no | **add `uploadExpiresAt DateTime?`** |
| Last successful sync / raw Stream state (debugging, stuck detection) | no | **add `streamSyncedAt DateTime?`, `streamState String?`** |
| Reconciler query across shops | no index | **add `@@index([status, updatedAt])`** (system scan; tenant index rule still satisfied by the existing shopId-first indexes) |
| Duration / size / dimensions / failures | yes (`durationMs`, `sizeBytes`, `width`, `height`, `errorCode`, `errorMessage`) | reuse |
| Declared MIME type, rights, source, externalId (Instagram id) | yes | reuse |
| Playback / thumbnail URLs | — | **not stored**: derived from `streamUid` + signed token at request time |
| `originalKey`, `videoKey`, `previewKey`, `posterKey` | R2-only | **drop** (0 rows have values in dev; test branch empty) — needs your approval (Q8); alternative: keep as unused nullable columns |

So **one migration is needed** (`stream_video_fields`): additive columns + unique index + optional drop of the four R2 columns.
Procedure (Day 3): `prisma migrate dev --create-only` → review SQL → apply to the **test branch first** (`npm run test:db:migrate`)
→ run the full suite → apply to dev main. No reset, no data loss (no rows hold those values). Remember to stop `shopify app dev`
and Prisma Studio before generating (Day 2 lesson).

No R2 compatibility layer or dual storage: there is no R2 data to migrate.

---

## 7. Testing strategy (all affected days)

- **Mocked Stream API**: `stream.server.js` takes an injectable `fetch`; tests use recorded-shape JSON fixtures in `tests/fixtures/stream/` (direct upload, video details per state, error codes, list, delete 200/404, 401/429/5xx). No new dependency (no `msw`, no `aws-sdk-client-mock`).
- **Crypto-level tests**: JWT signed with a test RSA key generated in the test (verify signature with `crypto.verify`, check `kid`, `sub`, `exp ≤ 24 h`); webhook HMAC with a test secret.
- **DB tests** only on the Neon test branch (existing guard), with per-test cleanup as in Day 2.
- **Real Stream** only in explicitly run smoke scripts (`npm run stream:smoke`), never in `npm test`; they create and then delete their own videos and print no secrets.
- Per-day test lists and acceptance criteria are in §1.

---

## 8. Cost and usage risks (from the official pricing page)

Pricing: **storage $5 / month per 1,000 minutes, prepaid**; **delivery $1 per 1,000 minutes, post-paid**; ingress and encoding free; billed by duration (rounded up per second), not bytes. Unfinished direct uploads **reserve `maxDurationSeconds`** of storage until received or expired. Errored, deleted and expired uploads don't count. Client-side **preloading is billable**; web playback rounds to 4-second segments. Animated thumbnails don't count as delivered minutes. When prepaid storage is exhausted, **no new uploads are possible** (for every merchant at once).

| Scenario | Estimate |
|---|---|
| 100 free shops × 10 videos × 1 min | 1,000 min stored → **$5 / month** |
| Pending-upload reservations: 20 pending × 3 min per shop (cap) | up to 60 min reserved per shop while uploads are in flight |
| One busy store: 10,000 sessions/day, 2 HLS previews autoplaying 10 s each | ≈ 3,300 min/day ≈ 100,000 min/month → **≈ $100 / month for one merchant** |
| Same store, previews as animated thumbnails, 5 % open the player and watch 30 s | ≈ 250 min/day ≈ 7,500 min/month → **≈ $7.50 / month** |

Risks and mitigations:
1. **Delivery cost scales with merchant traffic, not our revenue** → no HLS autoplay previews (Q4), no segment preloading, plan-level caps on stored minutes, and (Day 13) consider delivered-minute limits or soft caps for the free plan.
2. **Shared prepaid storage pool** → daily storage-usage check, alert at 80 %, per-shop minute caps, pending-upload cap, reconciler releases expired reservations.
3. **Abuse via upload URL spam** → auth + plan limit + pending cap + 30-min expiry; reservations released on expiry.
4. **Unbounded paid plans** → define stored-minute caps per plan on Day 13 before submission.
5. Stream does not support caching/proxying manifests (docs: "Do not cache, proxy, or store manifests") → we only hand out URLs.

---

## 9. Decisions requiring your approval

| # | Question | Recommendation |
|---|---|---|
| Q1 | The roadmap has 20 days (+ Day 0), not 29. Revise these 21 entries as-is? | Yes; send the 29-day version if it exists elsewhere. |
| Q2 | Playback privacy: `requireSignedURLs: true` for every video + locally signed tokens (admin + storefront)? | **Yes** (private by default, prevents hotlinking/scraping). Alternative: public storefront videos — simpler, but anyone with a uid can play/embed them. |
| Q3 | Storefront player tech | **Own `<video>` + native HLS + lazy vendored `hls.js` light build** (new dependency, loaded only when the player opens). Alternative: Stream player iframe (no dependency, less control over the shoppable overlay/swipe UX). |
| Q4 | Card previews (DESIGN.md "muted preview fades in") | **Animated thumbnail (GIF) while visible, max 2, off under reduced motion/Save-Data** — no delivered-minute cost but ~0.3–1 MB each; or poster-only. Not HLS previews (cost, §8). |
| Q5 | Background jobs (D2/D5) | **Keep pg-boss (D2), run it inside the web service; drop the separate Background Worker and the ffmpeg image (amends D5).** Jobs: reconcile, delete, prune, later IG token refresh/redact sweeps. Alternative: keep a small worker service. |
| Q6 | Environments (Stream allows **one webhook URL per account**) | **Separate Cloudflare account for production**; dev/staging share one account, dev re-registers the webhook to the current tunnel via script, and the reconciler covers gaps. |
| Q7 | Upload protocol | **Basic direct upload for v1** (D9's 200 MB equals Stream's basic limit; no client dependency); tus (requires a client library) deferred unless upload reliability becomes a problem. Size check uses 200,000,000 bytes to stay under Stream's cap whichever MB definition it uses. |
| Q8 | Drop the four empty R2 columns in the Day 3 migration? | **Yes** (0 rows hold data); otherwise keep them nullable and unused. |
| Q9 | D9 wording | Keep input rules (MP4/MOV/WebM, ≤ 200 MB, ≤ 3 min); replace output spec ("H.264/AAC MP4, 720p, +faststart") with "Stream-managed adaptive HLS/DASH". |
| Q10 | D8 (custom media domain) | Mark **superseded** — playback is served from `customer-<CODE>.cloudflarestream.com`. |
| Q11 | Uncommitted `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | **Remove** in Day 3 (`npm uninstall …`); or discard the uncommitted `package.json`/lock changes yourself. |
| Q12 | Plan limits in minutes (Day 13) | Agree now that plans will cap stored minutes as well as video count (numbers decided on Day 13). |

---

## 10. Obsolete R2/ffmpeg tasks removed or replaced

| Old task (day) | Replacement |
|---|---|
| R2 bucket, bucket token, enable r2.dev (Day 0) | Stream subscription + Stream:Edit token + customer code |
| `storage.server.js` presign PUT / HeadObject / deletePrefix / publicUrl (Day 3) | `stream.server.js` direct upload / video details / delete / list; `playback.server.js` signed URLs |
| Signed Content-Type/Content-Length, HeadObject size check, file-signature (magic bytes) check (Day 3 plan) | Stream basic-upload 200 MB cap, `maxDurationSeconds`, `ERR_NON_VIDEO`; post-processing check of `duration`/`size` from the API |
| R2 CORS JSON + `docs/SETUP.md` (Day 3) | Not needed (Stream upload URLs accept browser uploads); `docs/STREAM.md` runbook |
| `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `aws-sdk-client-mock` | removed / not added |
| ffprobe validation, ffmpeg 720p transcode, 6 s preview clip, JPEG poster, deterministic output keys (Day 4) | Stream encoding (adaptive HLS/DASH), thumbnail URLs, animated thumbnails |
| `ffmpeg-static` / `ffprobe-static`, `FFMPEG_PATH`, `FFPROBE_PATH`, lavfi fixture videos (Day 4) | removed; fixtures are JSON API responses |
| `worker/index.js`, separate Render Background Worker, Docker image with system ffmpeg (Days 4, 12, 19) | pg-boss in the web process (Q5); plain Node Docker image |
| Cleanup job deleting stale R2 objects (Day 4) | reconciler deletes expired Stream placeholders |
| Proxy URLs built from `MEDIA_BASE_URL` (Day 8) | signed `customer-<CODE>.cloudflarestream.com/<token>/…` URLs |
| Muted MP4 preview clips in cards (Day 9) | animated thumbnails or poster-only (Q4) |
| Progressive MP4 playback (Day 10) | HLS (Q3) |
| Instagram media downloaded by the worker (Day 16) | `POST /stream/copy` from a fresh `media_url` |
| R2 custom domain, media cache headers, production CORS (Day 19, D8) | removed (D8 superseded) |
| `shop/redact` deletes R2 prefix `shops/{shopId}/` (Day 13) | delete stored uids + `creator = shopId` sweep via `stream-delete` jobs |
