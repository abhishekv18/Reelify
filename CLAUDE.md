# Reelify — Project Guide for Claude Code

This file is the source of truth for how this project is built. Read it fully before every task.
If anything here conflicts with the actual code or with current official Shopify / Meta documentation,
STOP, report the conflict, and propose a fix — do not silently pick one.

---

## 1. Product

Reelify is a public Shopify app for shoppable video (category: ReelUp, Tolstoy, Videowise).
Merchants upload their own videos (primary method) or import their own Instagram Reels (secondary, feature-flagged),
tag Shopify products, and show the videos on their storefront. Shoppers watch in a full-screen vertical player
and add tagged products to the cart without leaving the page.

Quality bar: native-feeling Shopify admin, fast and accessible storefront widget, eligible for App Store approval.

### v1 scope (must ship)
- Manual video upload with full server-side validation and a background processing pipeline
- Video library, product tagging, widgets (playlists) with placement rules
- Storefront: **Video Carousel** app block, **Product Videos** app block, shared **shoppable player** with Add to Cart
- Basic analytics: impressions, views, product clicks, add-to-carts
- Shopify App Pricing plans + server-side feature gating
- Uninstall handling, mandatory compliance webhooks, webhook idempotency
- Automated tests for all server services
- Instagram import (own Business/Creator account) — built, but **behind `FEATURE_INSTAGRAM`**

### v1 stretch (only if Phase A + B acceptance criteria pass)
- Floating Video Bubble (app embed), Video Stories block, admin live preview

### Out of scope for v1 (do not build, do not add schema for)
- TikTok (official API offers embeds, not video files)
- Revenue attribution / `orders/*` webhooks / `read_orders` (needs protected customer data review) → v1.1
- Grid widget, Instagram auto-import, daily analytics rollups, HLS streaming, A/B testing

---

## 2. Locked decisions

| ID | Decision |
|----|----------|
| D1 | Billing via **Shopify App Pricing** (hosted plan selection page). No Billing API charge creation. |
| D2 | Background jobs via **pg-boss** on the same PostgreSQL database. No Redis. |
| D3 | TikTok removed from v1. |
| D4 | Instagram import behind `FEATURE_INSTAGRAM` (default `false`). App Store submission happens with upload-only unless Meta approval is complete. |
| D5 | Hosting on **Render**: one Web Service + one Background Worker, Docker images with system ffmpeg. |
| D6 | Revenue attribution deferred to v1.1. |
| D7 | v1 storefront = carousel + product-page videos + player. |
| D8 | **PENDING** — production media custom domain not confirmed yet. All code reads media URLs from `MEDIA_BASE_URL`; never hard-code a host. r2.dev is allowed for local/dev only. |
| D9 | Upload limits: MP4 / MOV / WebM, ≤ 200 MB, ≤ 3 minutes. Output: H.264/AAC MP4, max 720p, `+faststart`. |

---

## 3. Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| App | Shopify React Router app template, **JavaScript only** | No TypeScript files. JSDoc types are welcome. |
| Admin UI | **Polaris web components** (`<s-page>`, `<s-section>`, …) + App Bridge | Use what the template ships. Do not add `@shopify/polaris` React or other UI kits. Verify tag names in current docs; never invent components. |
| Admin data | GraphQL Admin API only | No REST Admin API. |
| Database | PostgreSQL on Neon + Prisma | Use the Prisma version pinned by the template. No Prisma major upgrades. Follow that version's config style for connection URLs. |
| Sessions | Prisma session storage (template default) | |
| Jobs | pg-boss | Uses its own `pgboss` schema. Connects with `DIRECT_URL` (unpooled). |
| Media storage | Cloudflare R2 via `@aws-sdk/client-s3` | Public reads through `MEDIA_BASE_URL`. |
| Processing | ffmpeg + ffprobe | Local Windows dev: `ffmpeg-static` / `ffprobe-static` via `FFMPEG_PATH` / `FFPROBE_PATH`. Production: system ffmpeg in Docker. |
| Storefront | Theme App Extension (Liquid + vanilla JS + CSS) | No frameworks in the storefront bundle. |
| Storefront API | Shopify App Proxy `/apps/reelify/*` | Signature verified with `authenticate.public.appProxy`. |
| Tests | Vitest | Service/unit/integration tests. DB tests run against a separate Neon branch (`DATABASE_URL_TEST`). |
| Monitoring | Sentry (optional, via `SENTRY_DSN`) | |

### Template facts (fill in on Day 1 after inspecting the real project)
- Template / package versions: _TBD_
- `@shopify/shopify-app-react-router` version: _TBD_
- Prisma version and connection-config style: _TBD_
- Polaris version / how it is loaded: _TBD_
- Default scopes and webhooks in `shopify.app.toml`: _TBD_

---

## 4. Architecture

```
Shopify Admin (iframe)          Storefront (theme)
   │  App Bridge + Polaris         │  app blocks: carousel, product videos
   ▼                               │  JS: reelify.js  CSS: reelify.css
React Router app (Render Web) ◄────┘  via App Proxy /apps/reelify/*
   │   ├─ admin routes (authenticate.admin)
   │   ├─ proxy routes (authenticate.public.appProxy)
   │   ├─ webhooks (authenticate.webhook + idempotency)
   │   └─ services/*.server.js  (all DB access is tenant-scoped)
   ▼
PostgreSQL (Neon) ── Prisma tables + pgboss schema
   ▲
   │ pg-boss jobs
Render Background Worker (worker/index.js)
   └─ ffprobe validate → ffmpeg transcode → preview → poster → R2
Cloudflare R2  ──►  MEDIA_BASE_URL (public reads)
```

Product prices/availability on the storefront are **not** sent by our server. The proxy returns video data and
product **handles**; the widget fetches `window.Shopify.routes.root + 'products/' + handle + '.js'` so prices and
currency are correct for the shopper's market.

---

## 5. Folder conventions

```
app/
  routes/                 admin pages, api actions, proxy routes, webhooks
  components/             admin UI components (Polaris web components)
  services/               *.server.js — business logic, R2, jobs, plans, crypto, instagram
  repositories/           *.server.js — the ONLY place that touches Prisma for app data
  lib/                    shared pure helpers (validation schemas, constants)
worker/
  index.js                pg-boss worker entry
  jobs/                   one file per job type
extensions/
  reelify-widget/         theme app extension (blocks/, assets/, locales/, snippets/)
prisma/
  schema.prisma, migrations/
tests/
  unit/, integration/, fixtures/
docs/
  TESTING.md, DECISIONS.md
```

Server-only code must live in `*.server.js` files.

---

## 6. Data model rules

- Every app-data table has `shopId` (including join tables) with an index starting with `shopId`.
- All child rows cascade-delete from `Shop`.
- Never use `findUnique({ where: { id } })` on tenant data. Always `findFirst({ where: { id, shopId } })`,
  or a compound unique that includes `shopId`.
- Only `app/repositories/*.server.js` may query app tables. Every repository function takes `shopId` as its first argument.
- BigInt columns are serialized as strings in JSON responses.
- Migrations: always `prisma migrate dev --name <descriptive>`; never edit applied migrations; never run
  `migrate reset` or drop tables without asking me first.

### Core models (v1)
`Shop`, `Session` (template), `Video`, `VideoProduct`, `Widget`, `WidgetVideo`, `Placement`,
`SocialAccount`, `OAuthState`, `Event`, `ProcessedWebhook`, `RateLimit`.

---

## 7. Video lifecycle (single source of truth)

```
UPLOAD_PENDING → UPLOADED → PROCESSING → READY
                                  └────→ FAILED
```

1. **UPLOAD_PENDING** — server validates requested type/size against D9 and plan limits, creates the row,
   returns a presigned PUT URL with `ContentType` and `ContentLength` signed in. Rights checkbox is required.
2. **UPLOADED** — client calls `/complete`; server runs `HeadObject` and checks the real size and type; enqueues `process-video`.
3. **PROCESSING** — worker: ffprobe (must have a video stream, duration ≤ 180s, sane dimensions) → transcode to 720p
   H.264/AAC MP4 with `+faststart` → 6s muted preview clip → JPEG poster → upload outputs → update row.
4. **READY** — the only status ever returned to the storefront.
5. **FAILED** — `errorCode` ∈ `INVALID_FILE | TOO_LONG | TOO_LARGE | TRANSCODE_ERROR | SOURCE_UNAVAILABLE | COPYRIGHT_RESTRICTED`, plus a readable `errorMessage`.

Rules:
- Retries: max 3 with exponential backoff, only for transient errors (network, timeout, 5xx). Validation errors fail immediately.
- Jobs are idempotent: job key = video id; output keys are deterministic (`shops/{shopId}/videos/{videoId}/...`).
- A cleanup job deletes `UPLOAD_PENDING` rows older than 24h and their R2 objects.
- Instagram imports enter the same pipeline at PROCESSING with the Instagram `media_url` as source.
  If `media_url` is missing (Meta omits it for copyrighted content such as licensed Reel audio) → `COPYRIGHT_RESTRICTED`,
  and the UI suggests manual upload.

---

## 8. Security rules

- **Admin routes:** `authenticate.admin(request)` on every loader/action. Resolve `shopId` from the session, never from client input.
- **Proxy routes:** `authenticate.public.appProxy(request)`; shop comes from the verified request. Return READY videos only.
- **Webhooks:** `authenticate.webhook(request)` (HMAC; invalid → 401). Record `X-Shopify-Webhook-Id` in `ProcessedWebhook`
  (unique); duplicates return 200 without reprocessing. Prune records older than 30 days.
- **Uploads:** allow-list types, signed size/type, `HeadObject` check, ffprobe validation, keys generated server-side only.
- **Public events endpoint:** schema validation, max 50 events per batch, rate limit per IP + shop (Postgres-backed),
  verify video/widget ids belong to the shop, drop unknown fields.
- **Secrets:** AES-256-GCM for social tokens, with `ENCRYPTION_KEY_VERSION` stored per row. Never log tokens, codes or URLs containing tokens.
- **Instagram OAuth:** signed state (shopId + nonce + expiry, HMAC with `OAUTH_STATE_SECRET`), nonce stored in `OAuthState`, single use, 10-minute expiry.
- **Scopes:** `read_products` only. Ask before adding any scope.
- **GDPR:** we store no customer PII. Analytics use an anonymous random session id. `customers/data_request` and
  `customers/redact` are acknowledged and logged; `shop/redact` deletes all shop rows and the R2 prefix `shops/{shopId}/`.

---

## 9. Storefront rules

- Budget: JS ≤ 25 KB gzipped, CSS ≤ 8 KB gzipped. Nothing render-blocking (`defer` scripts).
- Classes prefixed `.rl-`, CSS custom properties prefixed `--rl-`, `font-family: inherit`.
- Reserve space with `aspect-ratio` → zero layout shift. Skeletons while loading.
- Videos: `muted playsinline`, `preload="none"` until near viewport, IntersectionObserver play/pause,
  max 2 previews playing at once, pause on `visibilitychange`. Always show the poster; autoplay may be blocked (iOS Low Power Mode).
- Cart: `window.Shopify.routes.root + 'cart/add.js'`; request theme sections via the `sections` parameter to refresh
  cart icon/drawer when present; fallback to a "View cart" link. Line item property `_rl_video` (underscore = hidden).
- Prices formatted with `Intl.NumberFormat` using the shopper's active currency.
- Accessible: dialog semantics, focus trap, ESC, return focus, 44px targets, `prefers-reduced-motion`.
- Must work in Dawn and at least one other free Online Store 2.0 theme.

---

## 10. Billing (Shopify App Pricing)

- Plans are defined in the Partner Dashboard, not in code. Plan handles: `free`, `pro`, `growth` (prices confirmed before submission).
- Upgrade/downgrade: send the merchant to Shopify's hosted plan selection page.
- Current plan detection must be verified against current Shopify docs on the billing day. Known per docs:
  a `plan_handle` parameter is appended on return from the plan page, and App Pricing does not send subscription
  webhooks for new integrations. Prefer an Admin API check if the docs confirm it works for App Pricing apps.
- `app/services/plan.server.js` owns limits and `canUse(shop, feature)`. Gating is enforced server-side (actions and proxy responses).

---

## 11. Feature flags

- `FEATURE_INSTAGRAM` (env, default `false`): hides Instagram UI and disables its routes and jobs (routes return 404).

---

## 12. Environment variables

```
SHOPIFY_API_KEY  SHOPIFY_API_SECRET  SHOPIFY_APP_URL  SCOPES=read_products
DATABASE_URL  DIRECT_URL  DATABASE_URL_TEST
R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET  MEDIA_BASE_URL
FFMPEG_PATH  FFPROBE_PATH
ENCRYPTION_KEY  ENCRYPTION_KEY_VERSION  OAUTH_STATE_SECRET
FEATURE_INSTAGRAM  INSTAGRAM_APP_ID  INSTAGRAM_APP_SECRET  INSTAGRAM_REDIRECT_URI
SENTRY_DSN  NODE_ENV
```

`.env` is git-ignored. `.env.example` lists every variable with no values.

---

## 13. Commands

```
shopify app dev            # run app + tunnel
npm run worker             # run pg-boss worker locally (separate terminal)
npm test                   # vitest
npx prisma migrate dev     # create/apply migration (dev)
npx prisma studio          # inspect data
shopify app deploy         # push config + extensions
shopify app webhook trigger --topic <topic> --address <url>
```

(Adjust on Day 1 if the template's scripts differ.)

---

## 14. Definition of done for every task

A task is not done until all of these hold:
1. Code follows sections 5–9.
2. Tests were added or updated for every new server service, and `npm test` passes.
3. No secrets or tokens are logged.
4. `PROGRESS.md` is updated.
5. You end your reply with this report:

```
### Report
**Files changed:** list
**Tests:** what was added; `npm test` result
**Commands I should run:** list
**Manual verification:** numbered steps on the dev store
**Known limitations / follow-ups:** list
```

## 15. Working rules

- Ask before: adding scopes, adding dependencies not listed here, changing locked decisions, destructive DB operations.
- Do not commit or push; I handle git.
- Prefer small, reviewable changes. If a task is too big for one session, finish a coherent part and record the rest in PROGRESS.md.
- When unsure about a Shopify or Meta API detail, check current official docs and cite the page in your report.
