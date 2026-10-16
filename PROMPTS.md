# Reelify — Daily Claude Code Prompts (v3 — Cloudflare Stream)

> **2026-10-13:** media moved from Cloudflare R2 + ffmpeg to **Cloudflare Stream** (D10–D13 in `docs/DECISIONS.md`).
> Days 0, 3, 4, 5, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 19, 20 were revised; Days 1, 2, 6, 11, 15 are unchanged.
> Day numbers and completed statuses are preserved. Setup/operations: `docs/STREAM.md`; rationale: `docs/STREAM_MIGRATION_PLAN.md`.
> The superseded R2/ffmpeg prompts are kept in git history (commit `f8ea4aa`) and in `D:\reelify-plan\PROMPTS.md`.

## How to use
1. Day 0 below is manual. After `shopify app init`, copy `CLAUDE.md` and `DESIGN.md` from this folder into the project root.
2. Each day: open VS Code terminal in the project → `claude` → `/clear` → paste the day's prompt.
3. Use Plan mode (Shift+Tab) for days marked **[PLAN]**: review the plan before approving.
4. Do not move to the next day until that day's acceptance criteria pass.
5. Commit yourself after each day (`git add . && git commit -m "Day N: ..."`).
6. If a day spills over: `Continue Day N from PROGRESS.md. Re-check its acceptance criteria.`

Phases:
- **A — Core MVP (Days 1–12):** upload to Stream → sync/webhooks → tag → widget → storefront → cart, deployed to staging.
- **B — Launch requirements (Days 13–16):** billing, compliance, analytics, Instagram (flagged).
- **C — Polish & submit (Days 17–20):** stretch widgets, design/perf pass, production, submission.

The MVP is complete only when: the Stream upload → READY flow (webhook and reconciler), tenant isolation, upload validation, webhook idempotency (Shopify and Stream) and automated tests all pass.

---

## Day 0 — Manual setup (you)

- [ ] Shopify Partner account + development store
- [ ] Neon project `reelify` (Postgres only). Create a second **branch** named `test` for automated tests. Copy pooled, direct and test connection strings.
- [ ] Cloudflare **Stream** on a non-production account (dev/staging) with prepaid storage capacity; a **separate production account** comes on Day 19 (D12). Follow `docs/STREAM.md` §3: `CLOUDFLARE_ACCOUNT_ID`, API token with **Account › Stream › Edit** (`CLOUDFLARE_STREAM_API_TOKEN`), customer code (`CLOUDFLARE_STREAM_CUSTOMER_CODE`). Signing key (Day 3) and webhook secret (Day 4) are created later by scripts.
- [ ] GitHub private repository
- [ ] Meta for Developers app (Business type) with Instagram product — create now; Business Verification can take time
- [ ] Generate secrets (run twice, one for each):
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  → `ENCRYPTION_KEY` and `OAUTH_STATE_SECRET`
- [ ] Create the app:
  ```bash
  shopify app init
  ```
  Choose the React Router template, JavaScript, name `reelify`. Then `cd reelify`, `git init`, run `shopify app dev` once and install on the dev store.
- [ ] Copy `CLAUDE.md` and `DESIGN.md` into the project root. Create `.env` with the values you have.

~~**Pending:** D8 custom media domain. Not needed until Day 19.~~ Superseded by D10 (Stream serves media).

---

# Phase A — Core MVP

## Day 1 — Inspect, foundation, PostgreSQL, tests [PLAN]
```text
Read CLAUDE.md and DESIGN.md fully. Do not build features today.

1. Inspect the real project before changing anything: package.json (scripts, dependency versions), template version, shopify.app.toml (scopes, webhooks, app proxy), app/shopify.server.js (auth, session storage, afterAuth hooks), app/db.server.js, prisma/schema.prisma and migrations, how Polaris web components and App Bridge are loaded, the extensions folder, and Node/CLI requirements. Do not assume any file or library exists — check.
2. Fill in the "Template facts" section of CLAUDE.md with what you found. List every place where CLAUDE.md conflicts with the real template, with a proposed resolution. Stop and ask me if a conflict affects a locked decision.
3. Switch Prisma from SQLite to PostgreSQL (Neon) using the connection-config style of the Prisma version the template pins: pooled DATABASE_URL for the app, DIRECT_URL for migrations. This is a fresh project with no data: remove the SQLite migrations and dev database, then create a new initial migration. Keep Prisma session storage.
4. Set scopes to read_products only.
5. Add Vitest: config, `npm test` script, a tests/ folder, a test setup that loads DATABASE_URL_TEST, and one smoke test. Integration tests must never run against DATABASE_URL.
6. Create .env.example with every variable from CLAUDE.md section 12 (no values). Confirm .env is git-ignored.
7. Create PROGRESS.md (20-day plan from PROMPTS.md, Day 1 status) and docs/DECISIONS.md (D1–D9 with status; D8 pending).

Acceptance criteria:
- App installs on the dev store; a Session row exists in Neon (verify with prisma studio).
- `npm test` passes.
- CLAUDE.md "Template facts" filled in; conflicts listed.
End with the Report from CLAUDE.md section 14.
```

## Day 2 — Schema, tenant isolation, idempotency [PLAN]
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. Implement the v1 Prisma schema per CLAUDE.md sections 6–7:
   - Shop (shopDomain unique, plan handle string default "free", settings Json, onboarding Json, installedAt, uninstalledAt)
   - Video (status enum UPLOAD_PENDING|UPLOADED|PROCESSING|READY|FAILED; source enum UPLOAD|INSTAGRAM; externalId; title; caption; originalKey; videoKey; previewKey; posterKey; mimeType; sizeBytes; width; height; durationMs; errorCode; errorMessage; attempts; rightsConfirmedAt; timestamps). Unique (shopId, source, externalId). Index (shopId, status, createdAt).
   - VideoProduct (shopId, videoId, productGid, handle, position) PK (videoId, productGid)
   - Widget (shopId, name, type enum CAROUSEL|PRODUCT_VIDEOS|BUBBLE|STORIES, isActive, settings Json, timestamps)
   - WidgetVideo (shopId, widgetId, videoId, position) PK (widgetId, videoId)
   - Placement (shopId, widgetId, pageType enum HOME|ALL_PRODUCTS|PRODUCT|COLLECTION, targetGid nullable)
   - SocialAccount (shopId, platform enum INSTAGRAM, externalUserId, username, profilePicUrl, accessTokenEnc, keyVersion, tokenIssuedAt, tokenExpiresAt, needsReconnect, lastSyncedAt) unique (shopId, platform)
   - OAuthState (nonce unique, shopId, expiresAt, usedAt)
   - Event (BigInt id, shopId, type enum IMPRESSION|VIEW|PRODUCT_CLICK|ADD_TO_CART, videoId, widgetId, productGid, sessionId, createdAt) index (shopId, createdAt), (shopId, type, createdAt)
   - ProcessedWebhook (webhookId unique, topic, shopDomain, processedAt)
   - RateLimit (key unique, count, windowStart) for Postgres-backed rate limiting
   All tenant tables cascade from Shop. No TikTok or attribution fields.
2. app/repositories/*.server.js: one file per aggregate; every function takes shopId first; findFirst({ where: { id, shopId } }) pattern; BigInt serialized as string.
3. app/services/shop.server.js: getOrCreateShop from session; wire into afterAuth; clear uninstalledAt on reinstall.
4. app/services/webhooks.server.js: withIdempotency(request, topic, handler) using X-Shopify-Webhook-Id.
5. app/services/crypto.server.js: AES-256-GCM encrypt/decrypt with key version.
6. Seed script (npm run seed) for the dev store.

Tests (integration, test DB):
- Shop A cannot read, update or delete Shop B's videos, widgets, placements or tags through any repository function.
- Duplicate webhook id is processed once.
- Crypto round-trip; tampered ciphertext fails.
Acceptance: migration applies cleanly on a fresh test branch; all tests pass. End with the Report.
```

## Day 3 — Stream client, Direct Creator Upload flow, video sync [PLAN]
```text
Read CLAUDE.md (sections 6–8), docs/STREAM.md, docs/DECISIONS.md and PROGRESS.md.

0. Remove the unused AWS SDK packages: confirm no imports, then `npm uninstall @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`; show the package diff.
1. app/services/stream.server.js: Cloudflare Stream REST client on fetch (no SDK, injectable fetch for tests): createDirectUpload({ maxDurationSeconds, expiry, creator, meta, requireSignedURLs, thumbnailTimestampPct }), getVideo(uid), deleteVideo(uid) (404 = done), listVideos({ creator, status, before, after, limit }). Lazy config (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_STREAM_API_TOKEN); errors never contain the token, upload URLs or signed URLs; 429/5xx surfaced as retryable errors.
2. Migration (reviewed, test branch first, never edit applied migrations): add Video.streamUid (unique), uploadExpiresAt, streamSyncedAt, streamState, index (status, updatedAt); drop originalKey/videoKey/previewKey/posterKey only after confirming no row holds data. Update WRITABLE_FIELDS; add getVideoByStreamUid (system lookup, webhook/reconciler only) and a guarded status-transition helper in the videos repository.
3. app/lib/streamStatus.js: Stream state → status mapping, Stream error code → errorCode mapping, forward-only transition rules (CLAUDE.md section 7).
4. app/services/videoSync.server.js: syncVideoFromStream — ownership check (uid, creator = shopId, meta.videoId), guarded transition, store durationMs/width/height/sizeBytes/streamState/streamSyncedAt, re-check D9 (> 180 s or > 200,000,000 bytes → FAILED + Stream delete).
5. POST /app/api/uploads (authenticate.admin; shop from session): validate { filename, contentType, sizeBytes, rightsConfirmed } (MP4/MOV/WebM, 1..200,000,000 bytes, rights === true); plan limit stub (app/services/plan.server.js: free = 10 videos; stored-minute limit placeholder, D13) and a pending-upload cap, inside one transaction with a per-shop advisory lock; create Video UPLOAD_PENDING; createDirectUpload with maxDurationSeconds 180, expiry ≈ 30 min, requireSignedURLs true, creator shopId, meta { app, shopId, videoId }; store streamUid + uploadExpiresAt; return { videoId, uploadURL, expiresAt }. Stream failure → delete the row, 502 with a plain message. Never log uploadURL.
6. POST /app/api/uploads/:id/complete: load by (id, shopId) (404 otherwise), never accept a uid from the client, getVideo(streamUid) → syncVideoFromStream; pendingupload → 409 UPLOAD_NOT_RECEIVED. Idempotent.
7. app/services/playback.server.js: RS256 JWT signing with node:crypto (kid, sub = uid, exp ≤ 24 h, optional nbf) and URL builders (iframe, HLS manifest, thumbnail.jpg, thumbnail.gif) using CLOUDFLARE_STREAM_CUSTOMER_CODE. scripts/stream-create-signing-key.js (npm run stream:signing-key) — prints instructions, writes key material only with --write-env.
8. .env.example: remove R2_*, MEDIA_BASE_URL, FFMPEG_PATH, FFPROBE_PATH; add the Stream variables (CLAUDE.md section 12).
9. scripts/stream-smoke.js (npm run stream:smoke): the real-account checks in docs/STREAM.md section 10; refuses production and the test DB; cleans up.

Tests (mocked Stream API in tests/fixtures/stream/, Neon test branch): validation rejections; plan limit and concurrency (8 existing, 5 parallel creates → exactly 2 succeed); direct-upload request body; Stream failure leaves no row; complete for each Stream state and each error code; cross-shop complete → 404 with no Stream call; creator/meta mismatch → no change; concurrent completes converge; forward-only transitions; JWT verifies with the public key, exp ≤ 24 h; no secrets/upload URLs/tokens in logs or errors.
Acceptance: npm test green; migration applied to the test branch then dev; real smoke test run and its observed behaviour recorded (do not claim real Stream behaviour without running it). End with the Report.
```

## Day 4 — Stream webhooks, reconciliation, deletion, background jobs [PLAN]
```text
Read CLAUDE.md, docs/STREAM.md (sections 5 and 7) and PROGRESS.md.

1. POST /webhooks/stream (no Shopify auth): read the raw body first; verify Webhook-Signature (time=…,sig1=…; HMAC-SHA256 of time + "." + rawBody with CLOUDFLARE_STREAM_WEBHOOK_SECRET; constant-time compare; reject stale/future timestamps) → 401 on failure. Look up by streamUid, re-fetch getVideo(uid), syncVideoFromStream. Unknown uid → 200 + warning. Short-circuit duplicates via ProcessedWebhook key stream:<uid>:<state>.
2. scripts/stream-webhook.js (npm run stream:webhook -- set --url …): PUT /stream/webhook; the returned secret is stored only in .env (never echoed unless --write-env). Document re-registration for each dev tunnel.
3. Background jobs: decide pg-boss-in-web-process vs Render Cron Job using docs/STREAM.md section 7 (keep pg-boss only if it runs reliably on the selected Render plan; ask before adding pg-boss as a dependency). Jobs: stream-reconcile (5 min: expired UPLOAD_PENDING → delete Stream placeholder + row; UPLOADED/PROCESSING not synced for 10 min → sync), stream-delete (retries with backoff, 404 = done, re-checks creator = shopId), prune-processed-webhooks (daily, > 30 days). Graceful shutdown on SIGTERM; /healthz reports last reconcile time.
4. DELETE /app/api/videos/:id (authenticate.admin): delete by (id, shopId) (tags/widget links cascade) and enqueue stream-delete { shopId, uid }. Cancelled uploads use the same path.
5. Retry semantics: FAILED uploads → "Upload again" (new video); SOURCE_UNAVAILABLE imports → "Retry import" (Day 16).

Tests: signature valid / wrong secret / tampered body / stale / future / malformed header; replayed ready → no double transition; out-of-order (ready then inprogress) stays READY; unknown uid → 200 no change; creator ≠ row shop → no change + error log; reconciler removes only expired pending rows and calls Stream delete only with stored uids; stuck processing synced; other shops untouched; delete job refuses a uid whose creator differs; prune.
Acceptance: a real dev upload reaches READY through the webhook (tunnel); with the webhook unregistered the reconciler reaches READY within one interval; deleting a video makes getVideo return 404. End with the Report.
```

## Day 5 — Videos library and detail UI
```text
Read CLAUDE.md, DESIGN.md (Part 1), docs/STREAM.md and PROGRESS.md.

Build with Polaris web components and App Bridge (verify tag names in current docs):
1. App navigation: Dashboard, Videos, Widgets, Analytics, Settings, Plans (placeholder pages for later ones).
2. /app/videos: drop zone + upload queue using the Day 3 flow — XMLHttpRequest multipart POST (field "file") directly to the one-time Stream uploadURL with progress, then /complete; cancel = abort + DELETE /app/api/videos/:id; retry = new upload; max 3 parallel. Rights checkbox. Library grid of 9:16 cards (signed static thumbnail from the loader, ~1 h token), status badges per DESIGN.md, search/filter/sort, cursor pagination (24), bulk delete, empty state, skeleton loading. Poll every 5 s (DB reads only) while any video is UPLOAD_PENDING/UPLOADED/PROCESSING.
3. /app/videos/:id: Cloudflare Stream embedded player with a signed token, title/caption form with App Bridge save bar, metadata (duration, dimensions from Stream), failed-state banner with "Upload again", delete with confirmation (row + stream-delete job).
4. Plain-language error messages for every errorCode (not a video, too long, too large, corrupt file, processing failed, source unavailable, licensed audio).

Tests: loader/action tests for list scoping, delete scoping (enqueues stream-delete with the stored uid only), signed URLs generated only for the shop's own videos.
Acceptance: all four states (loading, empty, error, success) visible and correct; upload → Processing → Ready works end to end on the dev store; works at mobile width. End with the Report.
```

## Day 6 — Product tagging and product webhooks
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. Tagged products card on video detail: App Bridge resource picker (products, multiple, preselected), list with image/title/status, drag and keyboard reorder, remove, saved via save bar.
2. app/services/products.server.js: GraphQL `nodes(ids:)` batch fetch for admin display (title, handle, featuredImage, status). Deleted/missing products shown as warning rows.
3. Webhooks products/update (refresh stored handle) and products/delete (remove VideoProduct rows for that shop) using withIdempotency. Declare them in shopify.app.toml.
4. Quick-tag action from library card menu.

Tests: tagging is shop-scoped; products/delete removes only that shop's rows; replayed webhook is ignored; handle update persists.
Acceptance: tag, reorder, remove; delete a product in admin → tag disappears. Verify webhooks with `shopify app webhook trigger`. End with the Report.
```

## Day 7 — Widgets editor
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. /app/widgets list (name, type, video count, placement summary, active toggle, updated) + empty state.
2. Create flow: choose type with visual cards — Carousel and Product videos enabled; Bubble and Stories shown as "Coming soon".
3. Editor: Videos (add READY videos from a searchable picker modal showing signed thumbnails, reorder, remove), Appearance (heading, card size S/M/L, radius 0–24, accent color, show product chip), Placement (HOME / ALL_PRODUCTS / PRODUCT via resource picker / COLLECTION via picker), Active. Save bar, validation, toasts.
4. Product videos type needs no video list (it uses tags) — show an explanatory card instead.
5. Plan gating stub: free = 1 widget.

Tests: widget CRUD scoped; cannot attach another shop's video or a non-READY video; placement validation; free plan limit.
Acceptance: create, edit, reorder, deactivate, delete widgets. End with the Report.
```

## Day 8 — App Proxy API and extension scaffold
```text
Read CLAUDE.md, DESIGN.md, docs/STREAM.md (section 8) and PROGRESS.md.

1. App proxy in shopify.app.toml: prefix "apps", subpath "reelify". Explain dev vs deployed behavior.
2. Proxy routes (authenticate.public.appProxy):
   - GET /apps/reelify/widgets/:id → widget settings + READY videos (id, title, width, height, durationMs, posterUrl = signed thumbnail.jpg, previewUrl = signed thumbnail.gif, playerUrl = signed iframe URL) + tagged product handles per video. Inactive/unknown → 404 JSON.
   - GET /apps/reelify/product-videos?handle= → READY videos tagged with that product (same video shape).
   - GET /apps/reelify/placements?pageType=&productGid=&collectionGid= → matching active widget ids.
   - Tokens: exp ≈ 6 h, signed per response; Cache-Control public max-age=60; never return the API token, unsigned uid URLs, non-READY videos or internal error details.
3. Generate the theme app extension `reelify-widget` (tell me the exact CLI command if I must run it) with empty blocks and assets.

Tests: unsigned request rejected; non-READY videos never returned; another shop's widget id → 404; product-videos only returns the requesting shop's videos; every media URL is signed with exp ≤ 24 h.
Acceptance: browser request to https://<dev-store>/apps/reelify/widgets/<id> returns correct JSON and the signed poster/player URLs load. End with the Report.
```

## Day 9 — Widget runtime and carousel block [PLAN]
```text
Read CLAUDE.md (section 9), DESIGN.md (Part 2), docs/STREAM.md (sections 6, 9) and PROGRESS.md.

1. assets/reelify.js (vanilla, deferred): data module (fetch + in-memory cache + dedupe), product module (fetch Shopify.routes.root + 'products/{handle}.js', cache, Intl.NumberFormat with active currency), preview manager (IntersectionObserver: static poster first; swap to the animated thumbnail only while ≥ 50 % visible, max 2 at once, never under reduced motion or Save-Data, poster fallback on error; pause/stop on hidden tab), renderer registry, event emitter for "open player". No HLS, video elements or iframes in cards.
2. assets/reelify.css with DESIGN.md tokens, .rl- classes, skeletons, reduced-motion handling.
3. blocks/carousel.liquid: settings (widget id, heading override, alignment, card size, show arrows, padding top/bottom, accent color); root element with data attributes; aspect-ratio reserved space; no inline blocking scripts.
4. Card UI per DESIGN.md (poster first, animated preview fade-in, product chip, play icon, hover lift, focus ring).
5. Report gzipped sizes of JS and CSS against the budget, and the bytes of animated previews loaded per page.

Acceptance: block added in Dawn theme editor renders correctly on desktop and mobile; zero layout shift (CLS); only visible cards animate (max 2); no billed video segments are requested by the carousel (check DevTools network); budgets met. End with the Report.
```

## Day 10 — Shoppable player and cart [PLAN]
```text
Read CLAUDE.md (section 9), DESIGN.md (Part 2 — Player), docs/STREAM.md (section 6 — embedded player limitations L1–L8) and PROGRESS.md.

0. Spike first (iOS Safari + Android Chrome): one Cloudflare embedded player iframe inside our dialog, Player API SDK loaded on open. Decide L1 option (a) gesture layer + own controls (controls=false) or (b) Stream controls + swipe on our chrome only, and confirm L4 (muted start, tap for sound). Record the result in docs/STREAM.md and PROGRESS.md before building.
1. Player module (shared by all widget types): our dialog chrome (close, prev/next, progress from timeupdate, mute toggle remembered in sessionStorage), one reusable iframe whose src (signed playerUrl) is swapped on navigation with the next poster shown while loading; swipe/wheel/arrow navigation per the spike; no preloading of neighbouring videos' media; on player error refetch fresh signed URLs once, then "Couldn't load video. Retry". No fullscreen/picture-in-picture permissions (L3).
2. Product sheet: single and multiple product layouts, compare-at price and sale badge, variant pills with unavailable states, live price.
3. Add to cart: POST Shopify.routes.root + 'cart/add.js' with items [{ id, quantity: 1, properties: { _rl_video: videoId } }] and `sections` for common cart icon/drawer ids when present in the DOM; update them; dispatch a `rl:cart:added` event; fallback "View cart" link. Button states per DESIGN.md. Handle 422 (sold out / limit) with inline message.
4. Accessibility per DESIGN.md (dialog, focus trap with iframe tabindex -1, ESC, return focus, scroll lock without jump).
5. Report the SDK + iframe weight separately from the 25 KB budget.

Acceptance: add to cart works in Dawn plus one other free OS 2.0 theme, on desktop Chrome, iOS Safari and Android Chrome; works on a store with a market subfolder (e.g. /en-ca/) if available; keyboard-only flow works; documented limitations match observed behavior. End with the Report.
```

## Day 11 — Product videos block and theme deep links
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. blocks/product-videos.liquid (product templates only): reads product.handle, calls /apps/reelify/product-videos, renders compact carousel; renders nothing (no spacing) when empty.
2. "Add to theme" deep links in the widget editor and dashboard checklist: open the theme editor with the correct block preselected for the right template (verify the current deep-link URL format in Shopify docs and cite it).
3. Dashboard onboarding checklist with automatic completion (upload, tag, widget created, block added — detect "block added" if reliably possible, otherwise a manual "I've added it" confirmation).

Acceptance: product with tagged videos shows them; product without shows nothing; deep links open the correct editor location. End with the Report.
```

## Day 12 — Staging deploy and MVP gate [PLAN]
```text
Read CLAUDE.md, docs/STREAM.md and PROGRESS.md.

1. Dockerfile for the single web service (plain Node, no ffmpeg), render.yaml (one paid always-on Web Service; plus a Render Cron Job only if Day 4 chose that fallback), `prisma migrate deploy` on release, /healthz (DB, last reconcile time, cached Stream API reachability).
2. A separate staging app config (shopify.app.staging.toml or equivalent per current CLI docs) pointing to the Render staging URL. Staging uses the non-production Cloudflare account with its own webhook registration (docs/STREAM.md section 2). Document every step in docs/DEPLOY.md.
3. Full MVP QA as a strict reviewer: trace upload → Stream processing → webhook → tag → widget → theme → player → cart on staging. Audit security rules (CLAUDE.md section 8) route by route, including /webhooks/stream and every place a signed URL is produced; list any route missing auth, scoping or validation. Fix all critical and high findings.
4. Create docs/TESTING.md: manual regression checklist covering Phase A.

MVP gate — all must be true:
- Valid upload → READY via Stream (webhook path and reconciler path); invalid → correct FAILED code (INVALID_FILE, TOO_LONG, TOO_LARGE); deletes remove the Stream video.
- Tenant isolation, upload validation, Shopify + Stream webhook idempotency and signature tests pass.
- `npm test` fully green. Storefront works on staging in two themes and three browsers. No secrets, upload URLs or tokens in logs.
End with the Report and an explicit MVP gate pass/fail table.
```

---

# Phase B — Launch requirements

## Day 13 — App Pricing, gating, uninstall, compliance [PLAN]
```text
Read CLAUDE.md (sections 8, 10), docs/STREAM.md (section 9) and PROGRESS.md.

1. Verify in current Shopify docs how an App Pricing app should determine the active plan (redirect `plan_handle`, Admin API, or other) and cite the pages. Propose the approach before implementing.
2. app/services/plan.server.js: plan limits as video count **and** stored video minutes (D13) — propose numbers from Stream pricing (storage $5/1,000 min/month, delivery $1/1,000 min) and confirm the final split with me; widgets, analytics, branding, Instagram (when flag on). canUse(shop, feature), assertLimit(shop, resource). Enforce in all relevant actions and in proxy responses (branding flag).
3. /app/plans: current plan, usage vs limits (videos and minutes), button to Shopify's hosted plan selection page; handle the return redirect and update Shop.plan. Upgrade prompts per DESIGN.md.
4. Webhooks with idempotency: app/uninstalled (set uninstalledAt, delete sessions), customers/data_request and customers/redact (acknowledge + log; no PII stored), shop/redact (delete all shop rows, enqueue stream-delete for every stored streamUid and sweep Stream videos with creator = shopId — page through the list API by date). Declare compliance topics in shopify.app.toml.
5. Tell me exactly which plans to create in the Partner Dashboard.

Tests: gating for every limited action (count and minutes); downgrade enforcement (existing data kept, new creation blocked); shop/redact deletes only that shop's rows and enqueues deletes only for that shop's uids/creator; invalid HMAC → 401; duplicate webhook ignored.
Acceptance: `shopify app webhook trigger` for all four topics behaves correctly. End with the Report.
```

## Day 14 — Event tracking and analytics
```text
Read CLAUDE.md, DESIGN.md, docs/STREAM.md and PROGRESS.md.

1. Widget tracking: IMPRESSION (50% visible once per widget per page), VIEW (3 s watched, from the embedded player's timeupdate), PRODUCT_CLICK, ADD_TO_CART. Anonymous random session id in sessionStorage. Batch; flush every 10 s and on pagehide via sendBeacon.
2. POST /apps/reelify/events: schema validation, ≤ 50 events, RateLimit table per IP+shop, verify ids belong to the shop, createMany. Scheduled job deletes events older than 90 days.
3. /app/analytics: 7/30/90-day range, KPI cards with change vs previous period, views and add-to-carts over time ($queryRaw grouped by day, shop-scoped), top videos table, empty state. Gated per plan.
4. Dashboard KPI cards.
5. Internal cost monitoring: daily job logs Stream storage usage (verify the endpoint in current Cloudflare docs) and warns at 80 % of purchased capacity. No merchant-facing change.

Tests: invalid payload rejected; foreign ids dropped; rate limit triggers; aggregates correct on seeded data and scoped by shop.
Acceptance: watching on the storefront produces events visible in analytics within a minute. End with the Report.
```

## Day 15 — Instagram connection (flagged) [PLAN]
```text
Read CLAUDE.md (sections 8, 11) and PROGRESS.md. Verify every endpoint against current Meta docs for "Instagram API with Instagram Login" and cite them.

1. All Instagram UI, routes and jobs gated by FEATURE_INSTAGRAM (routes 404 when off).
2. Settings → Connected accounts card per DESIGN.md.
3. OAuth start: create OAuthState (nonce, shopId, 10-min expiry), HMAC-signed state, open https://www.instagram.com/oauth/authorize top-level from the embedded app with scope instagram_business_basic.
4. Callback (no Shopify session): verify signature, nonce unused and unexpired, mark used; exchange code (server-side) → short-lived → long-lived token (ig_exchange_token); fetch user id, username, account type, profile picture; store encrypted with key version; redirect back into the embedded app with a success message.
5. Daily job: refresh tokens that are ≥ 24h old and expire within 10 days (ig_refresh_token); on failure set needsReconnect.
6. Disconnect: delete the SocialAccount row.
7. docs/META_SETUP.md: exact Meta dashboard configuration (redirect URIs for staging/production, permissions, adding Instagram testers) and the App Review submission checklist (privacy policy URL, screencast steps, Business Verification).

Tests: forged/expired/replayed state rejected; tokens never logged; refresh job selects the correct accounts; flag off → 404.
Acceptance: my own tester Business/Creator account connects on staging. Then I submit Meta App Review. End with the Report.
```

## Day 16 — Instagram import via Stream (flagged)
```text
Read CLAUDE.md (section 7), docs/STREAM.md and PROGRESS.md. Verify the fields accepted by Stream "upload via link" (POST /stream/copy) in current Cloudflare docs and cite them.

1. /app/videos/import/instagram: grid of the account's VIDEO media (paged via the Graph API), caption snippet, date; already-imported items disabled; items without media_url marked "Can't import (licensed audio or restricted)" with a link to manual upload; rights checkbox; sticky "Import N videos" bar (≤ 10 per request).
2. Import creates Video rows (source INSTAGRAM, externalId) and, with a media_url fetched fresh at import time, calls POST /stream/copy with creator = shopId, meta { app, shopId, videoId } and requireSignedURLs true; stores streamUid, status UPLOADED; webhook/reconciler finish it. Missing media_url → FAILED COPYRIGHT_RESTRICTED (no Stream call). ERR_FETCH_ORIGIN_ERROR → SOURCE_UNAVAILABLE with "Retry import" (fresh media_url, new copy). Duration > 180 s after processing → FAILED TOO_LONG + Stream delete. Expired token → needsReconnect + FAILED SOURCE_UNAVAILABLE.
3. Respect plan limits (videos and stored minutes).

Tests (mocked Graph and Stream APIs): duplicate import prevented by unique constraint; missing media_url path; fetch-origin error path; too-long path; token-expired path; limits enforced.
Acceptance: tester account reels import to READY; restricted reels show the right message. End with the Report.
```

---

# Phase C — Polish and submit

## Day 17 — Stretch widgets (only if the MVP gate and Phase B pass)
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md. Confirm in your first message that the Day 12 MVP gate and Days 13–16 acceptance criteria are recorded as passing in PROGRESS.md; if not, stop and list what is missing instead.

1. App embed "Floating video bubble": settings (widget id, position, size, offsets, pages to show on, delay, dismissible); resolves widget via placements when no id is set; draggable on desktop; dismissed for the session; shows a poster/animated thumbnail (never autoplaying video); opens the shared player.
2. If time remains: Video stories block (circular avatars from signed thumbnails, seen state in localStorage, stories mode in the shared player with segment progress and tap zones on our chrome — see docs/STREAM.md section 6).
3. Enable these types in the widget create flow.
Acceptance: bubble works on all page types without covering theme cart/chat buttons when offsets are used; budgets still met; no billed video segments before the player opens. End with the Report.
```

## Day 18 — Design, accessibility and performance pass
```text
Read DESIGN.md, docs/STREAM.md and PROGRESS.md.

1. Review every admin screen as a senior Shopify product designer against DESIGN.md and the Shopify App Design Guidelines: list concrete issues (hierarchy, spacing, copy, states, mobile), then fix them.
2. Admin live preview (stretch): sticky preview in the widget editor using the storefront CSS tokens, desktop/mobile toggle.
3. Storefront audit: keyboard-only run (including the embedded player), screen reader labels, contrast, reduced motion, 44px targets.
4. Performance: Lighthouse mobile on Dawn with and without the widget; report the score difference (target ≤ 10 points) and fix regressions. Report JS/CSS gzipped sizes, animated-preview bytes per page, and the player SDK + iframe weight separately.
5. Cost audit: measure billed delivered minutes per storefront session (count Stream segment requests) for carousel-only and player sessions; confirm the carousel requests none.
End with the Report including before/after numbers.
```

## Day 19 — Production deploy
```text
Read CLAUDE.md, PROGRESS.md, docs/DEPLOY.md and docs/STREAM.md.

1. Production Cloudflare account (D12): Stream enabled, prepaid storage capacity sized from the Day 13 plan limits, API token (Stream:Edit, this account only), customer code, signing key (npm run stream:signing-key), webhook (npm run stream:webhook -- set --url https://<prod>/webhooks/stream). Put the values only into Render environment variables.
2. Production Render web service (paid, always-on) + Cron Job if Day 4 chose that fallback; environment variables checklist; Neon production branch; `prisma migrate deploy`.
3. Production app config and `shopify app deploy` steps.
4. Monitoring: Sentry (if SENTRY_DSN set), structured logs without secrets/upload URLs/tokens, /healthz monitored (including last reconcile time), Stream storage usage alert at 80 %.
5. Post-deploy smoke test script/checklist, including one real upload → READY → signed playback → delete on production.
End with the Report.
```

## Day 20 — App Store readiness and submission
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. Audit against the current Shopify App Store requirements (cite the page): install flow lands in the app, embedded with App Bridge, minimal scopes, App Pricing configured and matching the listing, compliance webhooks, theme app extensions only, performance, no placeholder UI, error states. Pass/fail table; fix fails.
2. Ensure FEATURE_INSTAGRAM is off in production unless Meta approval is complete (ask me).
3. Public /privacy and /support routes. Privacy policy states exactly what we store: shop info, product ids, anonymous analytics, Instagram tokens (if enabled); uploaded videos are stored, encoded and delivered by Cloudflare Stream (sub-processor) and deleted on video deletion and shop/redact.
4. Listing copy (name options, subtitle, description, benefits, feature list, pricing text), screenshot plan (1600×900, captions), reviewer instructions (mention processing time after upload), screencast script.
5. Run docs/TESTING.md fully on production.
Update PROGRESS.md to "Ready for submission". End with the Report.
```

Then you submit: Partner Dashboard → app → Distribution → Shopify App Store → listing → submit.

---

## Helper prompts

**Bug**
```text
Read CLAUDE.md and PROGRESS.md. Error: <full error + where it happens>. Find the root cause, explain it in 2–3 lines, fix it properly, add a regression test if it is server-side, and end with the Report.
```

**Screen polish**
```text
Read DESIGN.md. Review <screen> as a senior Shopify product designer. List up to 10 concrete issues, then fix them. End with the Report.
```

**Phase review**
```text
Read CLAUDE.md and PROGRESS.md. Review all code from Phase <X> for correctness, tenant isolation, validation, webhook idempotency, secrets in logs, and DESIGN.md compliance. Fix critical/high issues, list the rest. End with the Report.
```

---

## External dependencies (outside the 20 days)
| Dependency | Needed for | Status |
|---|---|---|
| Meta App Review + Business Verification | Instagram for non-tester merchants | Submit on Day 15 |
| Shopify App Store review | Public listing | Submit on Day 20 |
| ~~D8 custom domain~~ | ~~Production media~~ | Superseded by D10 (Stream) |
| Cloudflare Stream production account + storage capacity | Production media | Day 19 (D12) |
| Protected customer data review | Revenue attribution (v1.1 only) | Not needed for v1 |

## v1.1 backlog
Revenue attribution (orders webhook + protected data Level 1), Instagram auto-import, grid widget, TikTok embeds, analytics rollups, own HLS player (native HLS / hls.js instead of the embedded player), tus resumable uploads > 200 MB, A/B tests.
