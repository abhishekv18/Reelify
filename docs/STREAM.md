# Reelify — Cloudflare Stream setup and operations

Decision: D10–D13 in `docs/DECISIONS.md` (2026-10-13). Migration rationale and cost analysis: `docs/STREAM_MIGRATION_PLAN.md`.
Everything marked **(verify)** is not stated in the Cloudflare docs read on 2026-10-13 and must be confirmed by the
real-account smoke tests before it is relied on.

Official docs: [Stream overview](https://developers.cloudflare.com/stream/) ·
[Direct Creator Uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/) ·
[direct_upload API](https://developers.cloudflare.com/api/resources/stream/subresources/direct_upload/methods/create/) ·
[Webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/) ·
[Signed URLs](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/) ·
[Stream Player](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/) ·
[Player API](https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/) ·
[Thumbnails](https://developers.cloudflare.com/stream/viewing-videos/displaying-thumbnails/) ·
[Pricing](https://developers.cloudflare.com/stream/pricing/) ·
[Render free instances](https://render.com/docs/free)

---

## 1. What Stream does vs what Reelify does

| Cloudflare Stream | Reelify |
|---|---|
| Stores the uploaded file, encodes it, serves adaptive HLS/DASH, the embedded player, JPG/GIF thumbnails | Shopify auth, shop ownership (`Video.shopId` + Stream `creator`), plan limits, rights confirmation |
| Enforces `maxDurationSeconds`, the 200 MB basic-upload cap, rejects non-video input | Validates type/size before issuing an upload URL; re-checks duration/size after processing |
| Signs nothing for us — we sign playback tokens with our signing key | Issues short-lived signed URLs only for the requesting shop's videos |
| Sends one webhook per account when processing finishes or fails | Verifies the webhook, re-reads the API, applies forward-only status changes |

## 2. Accounts and environments (D12)

| Environment | Cloudflare account | Webhook URL | Notes |
|---|---|---|---|
| Local dev | non-production account | current dev tunnel `https://<tunnel>/webhooks/stream` | re-register on each `shopify app dev` (tunnel URL changes); the reconciler covers gaps |
| Staging (Day 12) | same non-production account **or** its own | staging URL | only one webhook URL per account: if dev and staging share an account, the last registration wins — prefer a separate staging account if both run at once |
| Production (Day 19) | **separate production account** | production URL | own token, customer code, signing key, webhook secret; storage capacity purchased here |

Never copy production credentials into a dev `.env`.

## 3. One-time setup per account (you)

1. **Enable Stream** on the account and buy prepaid storage capacity ($5 / month per 1,000 minutes; uploads stop when it is exhausted).
2. **Account ID** → `CLOUDFLARE_ACCOUNT_ID` (dashboard sidebar / URL).
3. **API token**: My Profile → API Tokens → Create Token → Custom: permission **Account › Stream › Edit**, account resources:
   only this account, optional IP filtering for production, sensible TTL → `CLOUDFLARE_STREAM_API_TOKEN`. One token per environment.
4. **Customer code**: Stream dashboard → any video's embed/HLS URL `https://customer-<CODE>.cloudflarestream.com/...` → `CLOUDFLARE_STREAM_CUSTOMER_CODE`.
5. **Signing key** (Day 3): `npm run stream:signing-key -- --write-env` calls `POST /stream/keys` and appends
   `CLOUDFLARE_STREAM_SIGNING_KEY_ID` and the base64 `CLOUDFLARE_STREAM_SIGNING_KEY_JWK` to `.env` (the private key is shown
   **once** by Cloudflare). It refuses to run without `--write-env`, refuses if a key is already configured, and never prints the key.
6. **Webhook** (Day 4): `npm run stream:webhook -- set --url https://<host>/webhooks/stream` calls `PUT /stream/webhook`; store the
   returned `secret` as `CLOUDFLARE_STREAM_WEBHOOK_SECRET`. Whether re-registering rotates the secret is **(verify)** — always
   take the secret from the latest response.

All six values live only in `.env` / Render environment variables. They are never committed, logged, sent to the browser
or included in proxy responses.

## 4. Upload flow and limits (Day 3)

1. Admin `POST /app/api/uploads` `{ filename, contentType, sizeBytes, rightsConfirmed }` → server checks: authenticated shop,
   type ∈ MP4/MOV/WebM, `1 ≤ sizeBytes ≤ 200,000,000`, `rightsConfirmed === true`, plan limits (count + stored minutes, D13),
   pending-upload cap.
2. Server creates `Video` (`UPLOAD_PENDING`), then `POST /stream/direct_upload` with `maxDurationSeconds: 180`,
   `expiry` ≈ now + 30 min, `requireSignedURLs: true`, `creator: <shopId>`, `meta: { app: "reelify", shopId, videoId }`.
   Stores `streamUid`, `uploadExpiresAt`. Returns the one-time `uploadURL` (never logged).
3. Browser: `multipart/form-data` POST with field `file` to `uploadURL` (basic uploads ≤ 200 MB; tus is required above that
   and is out of scope for v1).
4. Browser: `POST /app/api/uploads/:id/complete` → server `GET /stream/{uid}` → `syncVideoFromStream`.
5. Processing finishes → webhook (Day 4) or reconciler → `READY` / `FAILED`.

Reserved storage: each unfinished upload reserves `maxDurationSeconds` (180 s) of the prepaid capacity until it is received
or the link expires — hence the pending-upload cap and the reconciler.

Open points validated in the Day 3 smoke test: default/min/max `expiry` **(verify)**; exact error/HTTP status when a basic
upload exceeds 200 MB or the duration limit **(verify)**; whether Stream's 200 MB is 200,000,000 or 209,715,200 bytes —
our 200,000,000 cap is safe either way.

## 5. Webhooks and reconciliation (Day 4)

- Verify `Webhook-Signature: time=<unix>,sig1=<hex>` = HMAC-SHA256(`time + "." + rawBody`, secret), constant-time compare,
  reject timestamps older than 5 min (or > 1 min in the future). Read the raw body **before** any JSON parsing.
- After verification: look up `Video` by `streamUid`, re-fetch `GET /stream/{uid}`, run the ownership-checked sync. Unknown uid →
  200 + warning. Cloudflare does not document retries or delivery guarantees, so the reconciler is mandatory, not optional.
- Reconciler (every 5 min): expired `UPLOAD_PENDING` → delete Stream placeholder + row; `UPLOADED`/`PROCESSING` not synced for
  10 min → sync. Uses the `(status, updatedAt)` index.

## 6. Embedded player (D11): integration and known limitations

**Integration**: our dialog (`role="dialog"`, close, prev/next, product sheet, mute/progress chrome) contains one iframe
`https://customer-<CODE>.cloudflarestream.com/<SIGNED_TOKEN>/iframe?muted=true&preload=none&poster=<signed thumbnail, URI-encoded>&letterboxColor=transparent`
with `allow="autoplay; encrypted-media"` (no `fullscreen`/`picture-in-picture` — see below). The Player API SDK
(`https://embed.cloudflarestream.com/embed/sdk.latest.js`) is loaded only when the player first opens; `Stream(iframe)`
gives `play()` (returns a Promise), `pause()`, `muted`, `currentTime`, `duration`, `paused` and events (`play`, `pause`,
`timeupdate`, `ended`, `error`, `loadeddata`, `waiting`, …).

**Limitations for shoppable overlays and mobile swipe — must be designed around on Day 10:**

| # | Limitation (cause) | Impact | MVP workaround |
|---|---|---|---|
| L1 | Pointer/touch events that start on a cross-origin iframe are delivered to the iframe, not our page. | We cannot detect vertical swipes or taps on the video surface. | Choose on Day 10 (spike on iOS Safari + Android Chrome): **(a)** transparent gesture layer over the iframe (we handle tap = play/pause via Player API, swipe = next/prev), with Stream controls hidden (`controls=false`) and our own accessible controls; or **(b)** keep Stream's controls and limit swipe to our chrome (top/bottom zones), arrow buttons, keyboard and wheel. (a) is closer to DESIGN.md; (b) keeps Stream's captions/quality menu. |
| L2 | Keyboard events inside the iframe never reach our page; focus can move into the iframe. | ESC/arrow keys and the focus trap break once focus is inside the player. | Give the iframe `tabindex="-1"`; keep focus on our controls (natural with option L1-a); re-check ESC/arrows with a keyboard-only run. |
| L3 | Native fullscreen / picture-in-picture shows only the iframe. | The product sheet and Add to cart disappear. | Do not grant `fullscreen`/`picture-in-picture`; our dialog is already full-viewport on mobile. |
| L4 | User activation is per frame; autoplay with sound and programmatic unmute across the iframe boundary vary by browser **(verify)**. | Opening the player may start muted or not start at all (iOS Low Power Mode). | Start with `muted=true`; show poster + play button; "Tap for sound" uses the Player API; handle the rejected `play()` Promise. |
| L5 | Each iframe loads the Stream player document and scripts (third-party weight, not in our 25 KB budget). | Slower open; Lighthouse impact when the player opens. | One reusable iframe per dialog; swap the `src` (signed token) on next/prev, show the next poster while it loads; never pre-create iframes for neighbours (also avoids billed preloading). |
| L6 | Player API is postMessage-based (asynchronous). | Progress bar and "3 s watched" analytics are approximate. | Use `timeupdate`; VIEW event after `currentTime ≥ 3`. |
| L7 | If the SDK script is blocked (ad blocker, strict theme CSP) we lose programmatic control. | Custom controls/progress/analytics stop. | Fall back to Stream's native controls (`controls=true`); product sheet still works. |
| L8 | Signed token in `src` expires (we use hours). | Long-open players or cached proxy data can fail with 401/403. | On `error`, refetch fresh signed URLs from the proxy once, then show "Couldn't load video. Retry". |

If L1/L4 cannot meet DESIGN.md on real devices, record it and revisit "own `<video>` + native HLS / hls.js" after the MVP (D11 note).

## 7. Background jobs inside the web service (D2 amended): operational risks

pg-boss runs in the Render Web Service process (no Background Worker). It is used only for: `stream-reconcile` (every 5 min),
`stream-delete` (retries), `prune-processed-webhooks` (daily), later Instagram token refresh (Day 15) and redact sweeps (Day 13).
Correctness never depends on these being timely: the webhook path is primary, jobs are a safety net.

| Risk | Detail | Mitigation / decision rule |
|---|---|---|
| Instance sleeps | Render **free** web services spin down after 15 min without inbound HTTP traffic (official docs) — timers inside the process stop; free instances are "not for production". | Require a **paid, always-on** instance for staging/production. Local dev is fine (process runs while `shopify app dev` runs). |
| Deploys / restarts | SIGTERM during a deploy interrupts running jobs. | Graceful `boss.stop()` on SIGTERM; all job handlers idempotent; pg-boss retries interrupted jobs. |
| Multiple instances | Scaling the web service starts several pg-boss instances. | pg-boss coordinates through Postgres locks; confirm that cron schedules fire once per tick across instances with the pinned version **(verify Day 4)**. |
| Resource contention | Jobs share CPU, memory and the event loop with web requests. | Our jobs are I/O-bound API calls; low concurrency (1–2), small batches, timeouts on Stream calls. |
| Neon compute never sleeps | pg-boss polls the database continuously, so Neon compute will not scale to zero (compute-hour cost) and holds `DIRECT_URL` connections. | Longer polling interval for maintenance queues; count connections against Neon limits; accept for production (always-on anyway), note for dev. |
| Silent failures | A crashed schedule just stops. | Log + Sentry on job failure; `/healthz` reports last successful reconcile time; alert if older than 30 min. |
| Fallback | If any risk above is unacceptable on Day 4 or Day 12 | Drop pg-boss; run the same service functions from a **Render Cron Job** (`node scripts/maintenance.js reconcile|prune`) and do deletes inline with retries. Record the change as a D2 amendment. |

## 8. Signed playback

- Tokens: RS256 JWT, header `{ alg: "RS256", kid }`, payload `{ sub: <uid>, kid, exp, nbf? }`, signed with the JWK private key via
  `node:crypto` (no dependency). `exp` ≤ 24 h (Stream limit). TTLs: admin ≈ 1 h, storefront proxy ≈ 6 h (responses cached ≤ 60 s).
- URLs (token replaces the uid): iframe `…/<TOKEN>/iframe`, HLS `…/<TOKEN>/manifest/video.m3u8`, thumbnail
  `…/<TOKEN>/thumbnails/thumbnail.jpg?time=1s&height=640` and animated `…/<TOKEN>/thumbnails/thumbnail.gif?time=0s&duration=4s&height=360`.
  That thumbnails/GIFs accept a token in place of the uid is implied by the docs **(verify in the Day 3 smoke test)**.
- `allowedOrigins` stays empty (any origin): storefront custom domains change; signed tokens are the access control.
- Signing key rotation: create a new key, deploy both ids for the token TTL window (tokens carry `kid`), switch signing to the new
  key, then delete the old key via the API.

## 9. Cost and capacity

- Storage $5 / month per 1,000 minutes (prepaid); delivery $1 per 1,000 minutes (post-paid, 4-second segments, preloading billed);
  encoding and ingress free; animated thumbnails not counted as delivered minutes.
- Exhausted storage blocks **all** uploads → check storage usage daily (endpoint **(verify Day 14/19)**), alert at 80 %.
- Plan limits include stored minutes (D13). No autoplay HLS in cards (D11). Do not preload neighbours.

## 10. Smoke tests (real account, never part of `npm test`)

`npm run stream:smoke -- --shop <store>.myshopify.com --file <small.mp4>` (Day 3; refuses production env and the test DB):
1. valid MP4 → upload URL → multipart upload → `/complete` → poll until READY; duration/dimensions stored;
2. signed thumbnail and iframe URLs → 200; same URLs with the bare uid → 401/403;
3. text file renamed `.mp4` → FAILED `INVALID_FILE` (`ERR_NON_VIDEO`);
4. clip > 180 s → FAILED `TOO_LONG` (`ERR_DURATION_EXCEED_CONSTRAINT`);
5. declared size > 200,000,000 → rejected before any Stream call;
6. records the observed `expiry` handling and error formats in `PROGRESS.md`;
7. deletes every Stream video and row it created.
Automated tests use mocked Stream responses (`tests/fixtures/stream/`) and the Neon test branch only.

## 11. Runbook

| Symptom | Check / action |
|---|---|
| Video stuck in Processing | `GET /stream/{uid}` state; check webhook registration (`GET /stream/webhook`); reconciler last run in logs/`/healthz`. |
| Webhook 401s | Secret changed after re-registration → update `CLOUDFLARE_STREAM_WEBHOOK_SECRET`; server clock skew. |
| Uploads fail for everyone | Storage capacity exhausted or token revoked/expired → buy capacity / rotate token. |
| Playback 401/403 | Token expired, wrong `kid` after key rotation, wrong customer code. |
| Orphan Stream videos | List with `creator=<shopId>` and compare with `Video.streamUid`; delete via `stream-delete`. |

## 12. Open technical questions (honest list)

Status 2026-10-14 (Day 3): **none of these could be checked against a real account** — the configured
`CLOUDFLARE_STREAM_API_TOKEN` is rejected by Cloudflare (HTTP 401, codes 10000 on the Stream API and 1000 on
`/user/tokens/verify` and `/accounts/{id}/tokens/verify`). They remain open until `npm run stream:smoke` runs with a valid token.
Resolved by implementation (not by real-account tests): uid charset is restricted before any URL is built; a success
response with `result: null` (DELETE) is distinguished from 404.

1. Default / min / max of `direct_upload.expiry` — not in the docs read → smoke test.
2. Exact HTTP status and body when a basic upload exceeds 200 MB or `maxDurationSeconds` → smoke test.
3. Thumbnails and animated GIFs with a signed token in place of the uid → smoke test.
4. Whether `PUT /stream/webhook` rotates the secret on each call; retry/delivery behaviour of webhooks → Day 4.
5. Whether a webhook fires for every error (e.g. `ERR_NON_VIDEO`) → Day 4 (reconciler covers either way).
6. Fields accepted by `POST /stream/copy` (creator, requireSignedURLs, maxDurationSeconds?) → Day 16.
7. ~~Storage-usage endpoint path and response~~ **Answered 2026-10-14 (real account):** `GET /accounts/{id}/stream/storage-usage` → `{ creator, videoCount, totalStorageMinutes, totalStorageMinutesLimit }`. With `totalStorageMinutesLimit: 0`, `POST /stream/direct_upload` returns **HTTP 413, code 10011** (no capacity to reserve `maxDurationSeconds`).
8. Paging through > 1,000 videos in the list API (only date filters documented) → Day 13 redact sweep.
9. Whether `DELETE` is immediate and works on `pendingupload` placeholders → Day 4 (404 treated as done).
10. Cross-iframe autoplay/unmute and gesture behaviour on iOS Safari / Android Chrome (L1, L4) → Day 10 spike.
11. pg-boss cron de-duplication across multiple instances for the pinned version → Day 4.
12. Stream API rate limits for `direct_upload` creation → handle 429 with backoff; measure in smoke test.
