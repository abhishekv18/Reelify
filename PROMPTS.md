# Reelify — Daily Claude Code Prompts (v2, reviewed)

## How to use
1. Day 0 below is manual. After `shopify app init`, copy `CLAUDE.md` and `DESIGN.md` from this folder into the project root.
2. Each day: open VS Code terminal in the project → `claude` → `/clear` → paste the day's prompt.
3. Use Plan mode (Shift+Tab) for days marked **[PLAN]**: review the plan before approving.
4. Do not move to the next day until that day's acceptance criteria pass.
5. Commit yourself after each day (`git add . && git commit -m "Day N: ..."`).
6. If a day spills over: `Continue Day N from PROGRESS.md. Re-check its acceptance criteria.`

Phases:
- **A — Core MVP (Days 1–12):** upload → process → tag → widget → storefront → cart, deployed to staging.
- **B — Launch requirements (Days 13–16):** billing, compliance, analytics, Instagram (flagged).
- **C — Polish & submit (Days 17–20):** stretch widgets, design/perf pass, production, submission.

The MVP is complete only when: processing pipeline, tenant isolation, upload validation, webhook idempotency and automated tests all pass.

---

## Day 0 — Manual setup (you)

- [ ] Shopify Partner account + development store
- [ ] Neon project `reelify` (Postgres only). Create a second **branch** named `test` for automated tests. Copy pooled, direct and test connection strings.
- [ ] Cloudflare R2 bucket `reelify-videos` + API token (Object Read & Write, this bucket only). Enable r2.dev for development only.
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

**Pending:** D8 custom media domain. Not needed until Day 19.

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

## Day 3 — Storage service and validated upload flow
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. app/services/storage.server.js (R2 via @aws-sdk/client-s3, region "auto"): presignPut({ key, contentType, contentLength, expiresIn: 600 }) with ContentType and ContentLength signed; headObject; deleteObject; deletePrefix (paginated); publicUrl(key) using MEDIA_BASE_URL.
2. POST /app/api/uploads (authenticate.admin): body { filename, contentType, sizeBytes, rightsConfirmed }. Validate against D9 (type allow-list, ≤ 200 MB) and plan video limit (stub plan service returning free limits). Require rightsConfirmed. Create Video UPLOAD_PENDING; key = shops/{shopId}/videos/{videoId}/original.{ext} generated server-side. Return { videoId, uploadUrl, headers }.
3. POST /app/api/uploads/:id/complete: load video by (id, shopId); HeadObject; reject if missing, size mismatch or > limit (mark FAILED TOO_LARGE / INVALID_FILE and delete object); set UPLOADED; enqueue process-video (create a stub enqueue function in app/services/jobs.server.js for now — the real pg-boss wiring is Day 4).
4. Write the exact R2 CORS JSON I must apply (allow PUT from my app origin and dev tunnel, required headers), and add it to docs/SETUP.md.

Tests: validation rejections (type, size, missing rights, plan limit); complete() with mocked S3 (aws-sdk-client-mock) for size mismatch and success; cross-shop complete is rejected.
Acceptance: a real small MP4 uploads from a test page/script and reaches UPLOADED; a renamed .txt or oversized declaration is rejected. End with the Report.
```

## Day 4 — Worker and processing pipeline [PLAN]
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. app/services/jobs.server.js: pg-boss singleton using DIRECT_URL; send(name, data, { singletonKey, retryLimit: 3, retryBackoff: true }); replace Day 3's stub.
2. worker/index.js (npm run worker): starts pg-boss, registers jobs, graceful shutdown on SIGTERM. Concurrency 1 (configurable).
3. worker/jobs/process-video.js implementing CLAUDE.md section 7 exactly:
   - mark PROCESSING; download source to a temp dir (stream); ffprobe → validate video stream, duration ≤ 180s, dimensions sane; else FAILED (INVALID_FILE / TOO_LONG) with no retry.
   - ffmpeg: H.264/AAC MP4, max 720p keeping aspect, CRF ~26, preset veryfast, +faststart → video.mp4; 6s muted preview (480p) → preview.mp4; JPEG poster at ~1s → poster.jpg.
   - upload outputs to deterministic keys; update videoKey/previewKey/posterKey/width/height/durationMs; READY.
   - transient errors throw (pg-boss retries); after final attempt mark FAILED TRANSCODE_ERROR or SOURCE_UNAVAILABLE.
   - always clean temp files (finally).
   - idempotent: re-running a READY video is a no-op.
4. worker/jobs/cleanup-stale-uploads.js: scheduled hourly; deletes UPLOAD_PENDING older than 24h + objects.
5. ffmpeg paths from FFMPEG_PATH/FFPROBE_PATH with ffmpeg-static/ffprobe-static as local fallback (ask before adding these deps).
6. POST /app/api/videos/:id/retry for FAILED videos with a retriable code.

Tests: generate tiny fixture videos in test setup with ffmpeg (lavfi testsrc: valid 5s clip, 200s clip, audio-only file); pipeline marks valid → READY with three outputs (storage mocked or local), too long → TOO_LONG with no retry, audio-only → INVALID_FILE; re-run of READY is a no-op; stale cleanup removes only old pending rows of any shop.
Acceptance: upload in dev → worker → READY with poster and preview playable from MEDIA_BASE_URL. End with the Report.
```

## Day 5 — Videos library and detail UI
```text
Read CLAUDE.md, DESIGN.md (Part 1) and PROGRESS.md.

Build with Polaris web components and App Bridge (verify tag names in current docs):
1. App navigation: Dashboard, Videos, Widgets, Analytics, Settings, Plans (placeholder pages for later ones).
2. /app/videos: drop zone + upload queue using the Day 3 flow (XHR progress, cancel, retry, max 3 parallel), rights checkbox, library grid of 9:16 cards with status badges per DESIGN.md, search/filter/sort, cursor pagination (24), bulk delete, empty state, skeleton loading. Poll every 5s only while any video is UPLOAD_PENDING/UPLOADED/PROCESSING.
3. /app/videos/:id: player, title/caption form with App Bridge save bar, metadata, failed-state banner with Retry, delete with confirmation (deletes R2 prefix for that video).
4. Plain-language error messages for every errorCode.

Tests: loader/action tests for list scoping, delete scoping and R2 prefix deletion (mocked).
Acceptance: all four states (loading, empty, error, success) visible and correct; works at mobile width. End with the Report.
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
3. Editor: Videos (add READY videos from a searchable picker modal, reorder, remove), Appearance (heading, card size S/M/L, radius 0–24, accent color, show product chip), Placement (HOME / ALL_PRODUCTS / PRODUCT via resource picker / COLLECTION via picker), Active. Save bar, validation, toasts.
4. Product videos type needs no video list (it uses tags) — show an explanatory card instead.
5. Plan gating stub: free = 1 widget.

Tests: widget CRUD scoped; cannot attach another shop's video; placement validation; free plan limit.
Acceptance: create, edit, reorder, deactivate, delete widgets. End with the Report.
```

## Day 8 — App Proxy API and extension scaffold
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. App proxy in shopify.app.toml: prefix "apps", subpath "reelify". Explain dev vs deployed behavior.
2. Proxy routes (authenticate.public.appProxy):
   - GET /apps/reelify/widgets/:id → widget settings + READY videos (id, title, videoUrl, previewUrl, posterUrl, width, height, durationMs) + tagged product handles per video. Inactive/unknown → 404 JSON.
   - GET /apps/reelify/product-videos?handle= → READY videos tagged with that product.
   - GET /apps/reelify/placements?pageType=&productGid=&collectionGid= → matching active widget ids.
   - Responses: lean JSON, Cache-Control public max-age=60, never internal error details.
3. Generate the theme app extension `reelify-widget` (tell me the exact CLI command if I must run it) with empty blocks and assets.

Tests: unsigned request rejected; non-READY videos never returned; another shop's widget id → 404; product-videos only returns the requesting shop's videos.
Acceptance: browser request to https://<dev-store>/apps/reelify/widgets/<id> returns correct JSON. End with the Report.
```

## Day 9 — Widget runtime and carousel block [PLAN]
```text
Read CLAUDE.md (section 9), DESIGN.md (Part 2) and PROGRESS.md.

1. assets/reelify.js (vanilla, deferred): data module (fetch + in-memory cache + dedupe), product module (fetch Shopify.routes.root + 'products/{handle}.js', cache, Intl.NumberFormat with active currency), video manager (IntersectionObserver, preload none until near, max 2 previews, pause on hidden tab), renderer registry, event emitter for "open player".
2. assets/reelify.css with DESIGN.md tokens, .rl- classes, skeletons, reduced-motion handling.
3. blocks/carousel.liquid: settings (widget id, heading override, alignment, card size, show arrows, padding top/bottom, accent color); root element with data attributes; aspect-ratio reserved space; no inline blocking scripts.
4. Card UI per DESIGN.md (poster first, preview fade-in, product chip, play icon, hover lift, focus ring).
5. Report gzipped sizes of JS and CSS against the budget.

Acceptance: block added in Dawn theme editor renders correctly on desktop and mobile; zero layout shift (check with DevTools Performance/CLS); only visible previews play; budgets met. End with the Report.
```

## Day 10 — Shoppable player and cart [PLAN]
```text
Read CLAUDE.md (section 9), DESIGN.md (Part 2 — Player) and PROGRESS.md.

1. Player module (shared by all widget types): open animation, desktop and mobile layouts, swipe/wheel/arrow navigation, preload only next/previous, mute toggle remembered, tap pause, progress bar, video error state with retry.
2. Product sheet: single and multiple product layouts, compare-at price and sale badge, variant pills with unavailable states, live price.
3. Add to cart: POST Shopify.routes.root + 'cart/add.js' with items [{ id, quantity: 1, properties: { _rl_video: videoId } }] and `sections` for common cart icon/drawer ids when present in the DOM; update them; dispatch a `rl:cart:added` event; fallback "View cart" link. Button states per DESIGN.md. Handle 422 (sold out / limit) with inline message.
4. Accessibility per DESIGN.md (dialog, focus trap, ESC, return focus, scroll lock without jump).

Acceptance: add to cart works in Dawn plus one other free OS 2.0 theme, on desktop Chrome, iOS Safari and Android Chrome; works on a store with a market subfolder (e.g. /en-ca/) if available; keyboard-only flow works. End with the Report.
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
Read CLAUDE.md and PROGRESS.md.

1. Dockerfile for web and worker (system ffmpeg in worker image), render.yaml (Web Service + Background Worker), `prisma migrate deploy` on release, /healthz route.
2. A separate staging app config (shopify.app.staging.toml or equivalent per current CLI docs) pointing to the Render staging URL. Document every step in docs/DEPLOY.md.
3. Media: staging may use r2.dev (rate-limited, D8 pending) — note it as a known limitation.
4. Full MVP QA as a strict reviewer: trace upload → process → tag → widget → theme → player → cart on staging. Audit security rules (CLAUDE.md section 8) route by route and list any route missing auth, scoping or validation. Fix all critical and high findings.
5. Create docs/TESTING.md: manual regression checklist covering Phase A.

MVP gate — all must be true:
- Pipeline: valid → READY, invalid → correct FAILED code, retries only for transient errors.
- Tenant isolation tests pass. Upload validation tests pass. Webhook idempotency tests pass.
- `npm test` fully green. Storefront works on staging in two themes and three browsers.
End with the Report and an explicit MVP gate pass/fail table.
```

---

# Phase B — Launch requirements

## Day 13 — App Pricing, gating, uninstall, compliance [PLAN]
```text
Read CLAUDE.md (sections 8, 10) and PROGRESS.md.

1. Verify in current Shopify docs how an App Pricing app should determine the active plan (redirect `plan_handle`, Admin API, or other) and cite the pages. Propose the approach before implementing.
2. app/services/plan.server.js: plan limits (free: 10 videos, 1 widget, carousel + product videos, branding shown; pro: unlimited videos and widgets, analytics, no branding, Instagram when flag on; growth: pro + higher upload priority — confirm final split with me), canUse(shop, feature), assertLimit(shop, resource). Enforce in all relevant actions and in proxy responses (branding flag).
3. /app/plans: current plan, usage vs limits, button to Shopify's hosted plan selection page; handle the return redirect and update Shop.plan. Upgrade prompts per DESIGN.md.
4. Webhooks with idempotency: app/uninstalled (set uninstalledAt, delete sessions), customers/data_request and customers/redact (acknowledge + log; no PII stored), shop/redact (delete all shop rows and R2 prefix shops/{shopId}/). Declare compliance topics in shopify.app.toml.
5. Tell me exactly which plans to create in the Partner Dashboard.

Tests: gating for every limited action; downgrade enforcement (existing data kept, new creation blocked); shop/redact deletes only that shop's data and prefix; invalid HMAC → 401; duplicate webhook ignored.
Acceptance: `shopify app webhook trigger` for all four topics behaves correctly. End with the Report.
```

## Day 14 — Event tracking and analytics
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. Widget tracking: IMPRESSION (50% visible once per widget per page), VIEW (3s watched), PRODUCT_CLICK, ADD_TO_CART. Anonymous random session id in sessionStorage. Batch; flush every 10s and on pagehide via sendBeacon.
2. POST /apps/reelify/events: schema validation, ≤ 50 events, RateLimit table per IP+shop, verify ids belong to the shop, createMany. Scheduled job deletes events older than 90 days.
3. /app/analytics: 7/30/90-day range, KPI cards with change vs previous period, views and add-to-carts over time ($queryRaw grouped by day, shop-scoped), top videos table, empty state. Gated per plan.
4. Dashboard KPI cards.

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

## Day 16 — Instagram import into the pipeline (flagged)
```text
Read CLAUDE.md (section 7) and PROGRESS.md.

1. /app/videos/import/instagram: grid of the account's VIDEO media (paged via the Graph API), caption snippet, date; already-imported items disabled; items without media_url marked "Can't import (licensed audio or restricted)" with a link to manual upload; rights checkbox; sticky "Import N videos" bar.
2. Import creates Video rows (source INSTAGRAM, externalId, PROCESSING) and enqueues process-video with the media_url fetched fresh at job time (CDN URLs expire). Missing media_url at job time → FAILED COPYRIGHT_RESTRICTED (no retry). Expired token → needsReconnect + FAILED SOURCE_UNAVAILABLE.
3. Respect plan video limits.

Tests: duplicate import prevented by unique constraint; missing media_url path; token-expired path; limits enforced.
Acceptance: tester account reels import to READY; restricted reels show the right message. End with the Report.
```

---

# Phase C — Polish and submit

## Day 17 — Stretch widgets (only if the MVP gate and Phase B pass)
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md. Confirm in your first message that the Day 12 MVP gate and Days 13–16 acceptance criteria are recorded as passing in PROGRESS.md; if not, stop and list what is missing instead.

1. App embed "Floating video bubble": settings (widget id, position, size, offsets, pages to show on, delay, dismissible); resolves widget via placements when no id is set; draggable on desktop; dismissed for the session; opens the shared player.
2. If time remains: Video stories block (circular avatars, seen state in localStorage, stories mode in the player with segment progress and tap zones).
3. Enable these types in the widget create flow.
Acceptance: bubble works on all page types without covering theme cart/chat buttons when offsets are used; budgets still met. End with the Report.
```

## Day 18 — Design, accessibility and performance pass
```text
Read DESIGN.md and PROGRESS.md.

1. Review every admin screen as a senior Shopify product designer against DESIGN.md and the Shopify App Design Guidelines: list concrete issues (hierarchy, spacing, copy, states, mobile), then fix them.
2. Admin live preview (stretch): sticky preview in the widget editor using the storefront CSS tokens, desktop/mobile toggle.
3. Storefront audit: keyboard-only run, screen reader labels, contrast, reduced motion, 44px targets.
4. Performance: Lighthouse mobile on Dawn with and without the widget; report the score difference (target ≤ 10 points) and fix regressions. Report JS/CSS gzipped sizes.
End with the Report including before/after numbers.
```

## Day 19 — Production deploy
```text
Read CLAUDE.md and PROGRESS.md and docs/DEPLOY.md.

Before starting, ask me for the D8 decision (custom media domain). If confirmed: configure the R2 custom domain, set MEDIA_BASE_URL, long cache headers on media objects, production CORS. If not confirmed: stop at a checklist and do not deploy production media on r2.dev.

1. Production Render services (web + worker), environment variables checklist, Neon production branch, `prisma migrate deploy`.
2. Production app config and `shopify app deploy` steps.
3. Sentry for web and worker (if SENTRY_DSN set), structured logs without secrets, /healthz monitored.
4. Post-deploy smoke test script/checklist.
End with the Report.
```

## Day 20 — App Store readiness and submission
```text
Read CLAUDE.md, DESIGN.md and PROGRESS.md.

1. Audit against the current Shopify App Store requirements (cite the page): install flow lands in the app, embedded with App Bridge, minimal scopes, App Pricing configured and matching the listing, compliance webhooks, theme app extensions only, performance, no placeholder UI, error states. Pass/fail table; fix fails.
2. Ensure FEATURE_INSTAGRAM is off in production unless Meta approval is complete (ask me).
3. Public /privacy and /support routes. Privacy policy states exactly what we store: shop info, uploaded videos, product ids, anonymous analytics, Instagram tokens (if enabled).
4. Listing copy (name options, subtitle, description, benefits, feature list, pricing text), screenshot plan (1600×900, captions), reviewer instructions, screencast script.
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
| D8 custom domain | Production media | Pending your confirmation |
| Protected customer data review | Revenue attribution (v1.1 only) | Not needed for v1 |

## v1.1 backlog
Revenue attribution (orders webhook + protected data Level 1), Instagram auto-import, grid widget, TikTok embeds, analytics rollups, HLS, A/B tests.
