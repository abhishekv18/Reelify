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
- Manual video upload with full server-side validation; storage, encoding and delivery by **Cloudflare Stream** (D10)
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
- Grid widget, Instagram auto-import, daily analytics rollups, self-hosted HLS/encoding (Stream provides HLS/DASH), A/B testing
- Resumable (tus) uploads and files > 200 MB (Stream requires tus above 200 MB) → later, only if needed

---

## 2. Locked decisions

Superseded/amended rows keep their original text in `docs/DECISIONS.md`.

| ID | Decision |
|----|----------|
| D1 | Billing via **Shopify App Pricing** (hosted plan selection page). No Billing API charge creation. |
| D2 | *(amended 2026-10-13 by D10/D12)* Background jobs via **pg-boss** on the same PostgreSQL database, **run inside the web service** — only if Day 4 confirms it runs reliably there (D12). No Redis. No encoding jobs. |
| D3 | TikTok removed from v1. |
| D4 | Instagram import behind `FEATURE_INSTAGRAM` (default `false`). App Store submission happens with upload-only unless Meta approval is complete. |
| D5 | *(amended 2026-10-13 by D10)* Hosting on **Render**: one paid, always-on **Web Service**, plain Node Docker image (no ffmpeg, no Background Worker). |
| D6 | Revenue attribution deferred to v1.1. |
| D7 | v1 storefront = carousel + product-page videos + player. |
| D8 | *(superseded 2026-10-13 by D10)* ~~Production media custom domain / `MEDIA_BASE_URL` / r2.dev~~. Playback is served by Stream from `customer-<CODE>.cloudflarestream.com`. |
| D9 | *(amended 2026-10-13)* Upload limits: MP4 / MOV / WebM, **≤ 200,000,000 bytes**, **≤ 180 seconds**. Output: **Stream-managed adaptive HLS/DASH** (was: H.264/AAC MP4, 720p, `+faststart`). |
| D10 | **Cloudflare Stream** stores, encodes and delivers all videos (replaces R2 + ffmpeg). Basic **Direct Creator Uploads** for v1. Every video `requireSignedURLs: true`; playback only through short-lived tokens signed by our server. |
| D11 | Storefront and admin playback use **Cloudflare's embedded Stream player (iframe)** for the MVP; card previews are **animated thumbnails with a static poster fallback** — never autoplaying HLS in cards. |
| D12 | Separate Cloudflare account for **production** (Stream allows one webhook URL per account); dev/staging use a non-production account. |
| D13 | Plan limits cover **video count and stored video minutes** (numbers decided on Day 13). |

---

## 3. Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| App | Shopify React Router app template, **JavaScript only** | No TypeScript files. JSDoc types are welcome. |
| Admin UI | **Polaris web components** (`<s-page>`, `<s-section>`, …) + App Bridge | Use what the template ships. Do not add `@shopify/polaris` React or other UI kits. Verify tag names in current docs; never invent components. |
| Admin data | GraphQL Admin API only | No REST Admin API. |
| Database | PostgreSQL on Neon + Prisma | Use the Prisma version pinned by the template. No Prisma major upgrades. Follow that version's config style for connection URLs. |
| Sessions | Prisma session storage (template default) | |
| Jobs | pg-boss (inside the web process, D2) | Uses its own `pgboss` schema. Connects with `DIRECT_URL` (unpooled). Only for reconciliation, deletion retries, pruning and scheduled maintenance — never encoding. Risks: `docs/STREAM.md` §7. |
| Media | **Cloudflare Stream** REST API via `fetch` (`app/services/stream.server.js`) | No SDK. Direct Creator Uploads, video details/list/delete, webhooks, signed playback tokens (RS256 via `node:crypto`). Setup and operations: `docs/STREAM.md`. |
| Processing | Cloudflare Stream (managed encoding) | No ffmpeg/ffprobe anywhere in the project. |
| Player | Cloudflare Stream embedded player (iframe) + Player API SDK | Loaded only when the player opens. Limitations: `docs/STREAM.md` §6. |
| Storefront | Theme App Extension (Liquid + vanilla JS + CSS) | No frameworks in the storefront bundle. |
| Storefront API | Shopify App Proxy `/apps/reelify/*` | Signature verified with `authenticate.public.appProxy`. |
| Tests | Vitest | Service/unit/integration tests. DB tests run against a separate Neon branch (`DATABASE_URL_TEST`). |
| Monitoring | Sentry (optional, via `SENTRY_DSN`) | |

### Template facts (verified on Day 1, 2026-10-12, from installed `node_modules`)
- Template: `@shopify/shopify-app-template-react-router`, latest CHANGELOG entry **2026.02.09**. Package manager: **npm**
  (`package-lock.json`; a `pnpm-workspace.yaml` also ships with the template but is unused). `.npmrc` has `engine-strict=true`.
- Runtime/tooling: Node engines `>=20.19 <22 || >=22.12` (local: Node 22.18.0, npm 10.8.0, Shopify CLI 4.9.3).
  React 18.3, React Router **7.18.2** (`@react-router/fs-routes` flat routes via `app/routes.js`), Vite 6.4.4, Vitest 3.2.7 (added Day 1).
- `@shopify/shopify-app-react-router` **1.2.1** (bundles `@shopify/shopify-api` 13.1.0). `app/shopify.server.js`:
  `apiVersion: ApiVersion.July26` (2026-07), `distribution: AppStore`, `authPathPrefix: "/auth"`,
  `future.expiringOfflineAccessTokens: true`, scopes from `process.env.SCOPES`, optional `SHOP_CUSTOM_DOMAIN`. No `afterAuth` hook yet.
- Sessions: `@shopify/shopify-app-session-storage-prisma` **9.0.1** → `Session` model (includes `refreshToken`, `refreshTokenExpires`).
  `app/db.server.js`: PrismaClient singleton cached on `global.prismaGlobal` outside production.
- Prisma **6.19.3** (`prisma-client-js` generator). Connection config style: `url = env("DATABASE_URL")` (pooled) and
  `directUrl = env("DIRECT_URL")` (direct, used by migrate) in the `datasource` block of `schema.prisma`; no `prisma.config` file.
  Template shipped SQLite (`file:dev.sqlite`) → switched to Neon PostgreSQL on Day 1; initial migration `init_postgres_session`.
- Polaris: **Polaris web components** (`<s-page>`, `<s-section>`, `<s-app-nav>`, …) loaded from the CDN
  (`https://cdn.shopify.com/shopifycloud/polaris.js`) by `AppProvider` from `@shopify/shopify-app-react-router/react`, which also
  injects App Bridge (`https://cdn.shopify.com/shopifycloud/app-bridge.js`). Types: `@shopify/polaris-types` 1.1.0.
  `@shopify/app-bridge-react` 4.2.13 provides `useAppBridge()` (toast, intents, …). No `@shopify/polaris` React package.
- `shopify.app.toml`: scopes now `read_products` (template default was `write_products,write_metaobjects,write_metaobject_definitions`
  plus a demo product metafield and demo metaobject definition — removed). Webhooks `api_version = "2026-07"` (was 2027-01; aligned Day 2, C2):
  `app/uninstalled` → `/webhooks/app/uninstalled`, `app/scopes_update` → `/webhooks/app/scopes_update`. No compliance webhooks, no app proxy yet.
  `automatically_update_urls_on_dev = true`, `include_config_on_deploy = true`.
- `shopify.web.toml`: `predev = prisma generate`; `dev = prisma migrate deploy && react-router dev` (migrations auto-apply to `DIRECT_URL` on every `shopify app dev`).
- `extensions/`: empty (`.gitkeep` only). `Dockerfile`: `node:20-alpine`, `npm run docker-start` (= `prisma generate && prisma migrate deploy && react-router-serve`), no ffmpeg.
- Tooling present: ESLint 8 (`.eslintrc.cjs`), Prettier, `tsconfig.json` (`allowJs`, used for Polaris types/typegen), GraphQL codegen preset (`.graphqlrc.js`), `.mcp.json` with `@shopify/dev-mcp`.

### Template conflicts with this guide (Day 1) — none affect a locked decision
| # | Conflict | Resolution |
|---|----------|------------|
| C1 | Template scopes `write_products,write_metaobjects,write_metaobject_definitions` + demo metafield/metaobject; §8 says `read_products` only. | **Done:** scopes = `read_products`; demo definitions removed from toml; demo `productCreate` action in `app._index.jsx` replaced by a placeholder page. Merchant must approve the scope change on next load. |
| C2 | Webhook `api_version = "2027-01"` in toml vs `ApiVersion.July26` (2026-07) in `shopify.server.js`; the installed library has no 2026-10/2027-01 enum. | **Done (Day 2, approved):** toml webhook `api_version = "2026-07"`. Bump both together when the library ships a newer stable version. |
| C3 | `.gitignore` pattern `.env.*` also ignored `.env.example` (§12 expects it committed). | **Done:** added `!.env.example`. |
| C4 | "JavaScript only / no TypeScript files" vs template `tsconfig.json`, `typecheck` script, `@typescript-eslint`, `@types/*`. | Keep as-is: no `.ts` source files exist; `tsconfig.json` only powers editor types (Polaris web component types, React Router typegen) with `allowJs`. |
| C5 | `app/shopify.server.js` reads `SHOP_CUSTOM_DOMAIN`, not listed in §12. | Listed as optional in `.env.example`; leave unset. |
| C6 | §13 `npm run worker` does not exist yet. `npm test` added Day 1 (`vitest run`). `shopify app dev` is also `npm run dev`. | ~~Worker script arrives Day 4.~~ Superseded 2026-10-13: no worker process (D2/D5 amended); `stream:*` scripts arrive Days 3–4. |
| C7 | Template webhook handlers (`webhooks.app.*.jsx`) call `db.session` directly and have no idempotency; uninstall only deletes sessions. | Session is a template table (allowed). Idempotency + `uninstalledAt` arrive Day 2 / Day 13. |
| C8 | `shopify.web.toml` runs `prisma migrate deploy` on every `shopify app dev` (against `DIRECT_URL`). | Keep — desired for dev. Never point `DIRECT_URL` at production locally. |
| C9 | Template `Dockerfile` is a single web image on `node:20-alpine` without ffmpeg; D5 needs web + worker images with system ffmpeg. | Superseded 2026-10-13: D5 amended — the single plain Node web image is what we need; only Day 12 deploy tweaks remain. |
| C10 | Template home page/`/app/additional` are demo pages with demo nav. | Placeholder kept; real navigation per DESIGN.md on Day 5. |

---

## 4. Architecture

```
Shopify Admin (iframe)                         Storefront (theme)
   │  App Bridge + Polaris                        │  app blocks: carousel, product videos
   │  ① POST /app/api/uploads                     │  JS: reelify.js  CSS: reelify.css
   │  ② file → one-time Stream upload URL ──┐     │  GET /apps/reelify/* (App Proxy)
   │  ③ POST /app/api/uploads/:id/complete  │     │  signed iframe / thumbnail URLs
   ▼                                        ▼     ▼
React Router app (Render Web Service) ◄── Cloudflare Stream (storage, encoding, HLS/DASH, player, thumbnails)
   │   ├─ admin routes (authenticate.admin)          ▲ REST API (Bearer token, server only)
   │   ├─ proxy routes (authenticate.public.appProxy)│
   │   ├─ Shopify webhooks (authenticate.webhook + idempotency)
   │   ├─ Stream webhook /webhooks/stream (Webhook-Signature HMAC) ──► syncVideoFromStream
   │   ├─ pg-boss jobs in-process: stream-reconcile, stream-delete, prune (D2)
   │   └─ services/*.server.js  (all DB access is tenant-scoped)
   ▼
PostgreSQL (Neon) ── Prisma tables (Video.streamUid) + pgboss schema
```

Playback and thumbnail URLs are never stored: they are built per request from `Video.streamUid` and a signed token
(`app/services/playback.server.js`). Details: `docs/STREAM.md`.

Product prices/availability on the storefront are **not** sent by our server. The proxy returns video data and
product **handles**; the widget fetches `window.Shopify.routes.root + 'products/' + handle + '.js'` so prices and
currency are correct for the shopper's market.

---

## 5. Folder conventions

```
app/
  routes/                 admin pages, api actions, proxy routes, webhooks
  components/             admin UI components (Polaris web components)
  services/               *.server.js — business logic, Stream client, playback tokens, jobs, plans, crypto, instagram
  repositories/           *.server.js — the ONLY place that touches Prisma for app data
  lib/                    shared pure helpers (validation schemas, constants, Stream status mapping)
  jobs/                   *.server.js — one file per pg-boss job type, started by the web process (D2)
extensions/
  reelify-widget/         theme app extension (blocks/, assets/, locales/, snippets/)
prisma/
  schema.prisma, migrations/
tests/
  unit/, integration/, fixtures/
docs/
  TESTING.md, DECISIONS.md, STREAM.md
```

Server-only code must live in `*.server.js` files.

---

## 6. Data model rules

- Every app-data table has `shopId` (including join tables) with an index starting with `shopId`.
- All child rows cascade-delete from `Shop`.
- Never use `findUnique({ where: { id } })` on tenant data. Always `findFirst({ where: { id, shopId } })`,
  or a compound unique that includes `shopId`.
- Only `app/repositories/*.server.js` may query app tables. Every repository function takes `shopId` as its first argument.
  Documented exceptions: `shop.server.js` (tenant root, looked up by verified `shopDomain`) and the system tables
  `ProcessedWebhook` / `RateLimit` (not tenant data). The template `Session` table is accessed by the Shopify libraries and template routes.
- Child tables reference parents through composite `(shopId, id)` foreign keys, so the database rejects cross-shop links.
- New server modules use explicit `.js` import extensions so they also run under plain Node (seed and smoke scripts).
- `Video.streamUid` is globally unique. Looking a video up by `streamUid` without `shopId` is allowed **only** in the Stream
  webhook/reconciler path, and must be followed by the ownership check in §7 before anything is changed.
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
(R2/ffmpeg version of this section superseded 2026-10-13 by D10; history in `docs/DECISIONS.md`.)

| Our status | Cloudflare Stream `status.state` | Set by |
|---|---|---|
| `UPLOAD_PENDING` | upload URL issued / `pendingupload` | `POST /app/api/uploads` |
| `UPLOADED` | `downloading`, `queued` | sync (complete hint, webhook, reconciler) |
| `PROCESSING` | `inprogress` | sync |
| `READY` | `ready` **and** `readyToStream: true` | sync |
| `FAILED` | `error`, or our own checks | sync / upload validation |

1. **UPLOAD_PENDING** — server validates type/size against D9, rights confirmation and plan limits, creates the row, then
   calls Stream `POST /stream/direct_upload` with `maxDurationSeconds: 180`, `expiry` ≈ 30 min, `requireSignedURLs: true`,
   `creator: shopId`, `meta: { app: "reelify", shopId, videoId }`; stores `streamUid` + `uploadExpiresAt`; returns the
   one-time `uploadURL` to the authenticated admin only. If the Stream call fails, the row is deleted.
2. **UPLOADED / PROCESSING** — the browser posts the file (multipart, field `file`) directly to Stream, then calls
   `/complete` as a hint. The server never trusts the client: it calls `GET /stream/{streamUid}` and runs `syncVideoFromStream`.
3. **READY** — the only status ever returned to the storefront. Duration, size and dimensions come from the Stream API.
4. **FAILED** — `errorCode` ∈ `INVALID_FILE | TOO_LONG | TOO_LARGE | TRANSCODE_ERROR | SOURCE_UNAVAILABLE | COPYRIGHT_RESTRICTED`,
   plus a readable `errorMessage`. Stream mapping: `ERR_NON_VIDEO`, `ERR_MALFORMED_VIDEO`, `ERR_DURATION_TOO_SHORT` → `INVALID_FILE`;
   `ERR_DURATION_EXCEED_CONSTRAINT` → `TOO_LONG`; `ERR_FETCH_ORIGIN_ERROR` → `SOURCE_UNAVAILABLE`; `ERR_UNKNOWN` → `TRANSCODE_ERROR`
   ("processing failed"). Size over the limit → `TOO_LARGE`.

Rules:
- **One sync path:** `/complete`, the Stream webhook and the reconciler all call `syncVideoFromStream`. The API response is
  the source of truth; webhook payloads are only a trigger.
- **Ownership check before any change:** `details.uid === video.streamUid`, `details.creator === video.shopId`,
  `details.meta.videoId === video.id`. A mismatch changes nothing and is logged as an error.
- **Forward-only transitions:** guarded `updateMany` on `{ id, shopId, status ∈ allowedFrom }`; READY and FAILED are terminal,
  so duplicate or out-of-order notifications cannot move a video backwards.
- **Re-check D9 after processing:** duration > 180 s or size > 200,000,000 bytes → FAILED and the Stream video is deleted.
- **Expired uploads:** the reconciler deletes `UPLOAD_PENDING` rows whose `uploadExpiresAt` passed > 10 min ago, and their
  Stream placeholders (releases the reserved storage minutes).
- **Retries:** Stream cannot re-encode a failed upload → FAILED uploads offer "Upload again" (new video). Jobs retry only
  transient errors (network, timeout, 429, 5xx) with exponential backoff.
- **Deletion:** delete the row by `(id, shopId)`, then enqueue `stream-delete { shopId, uid }`; the job re-checks
  `creator === shopId` and treats 404 as done.
- **Instagram imports** (flagged) use Stream "upload via link" (`POST /stream/copy`) with a fresh `media_url` and enter at
  `UPLOADED`. Missing `media_url` (licensed audio etc.) → `COPYRIGHT_RESTRICTED`, and the UI suggests manual upload.

---

## 8. Security rules

- **Admin routes:** `authenticate.admin(request)` on every loader/action. Resolve `shopId` from the session, never from client input.
- **Proxy routes:** `authenticate.public.appProxy(request)`; shop comes from the verified request. Return READY videos only.
- **Webhooks:** `authenticate.webhook(request)` (HMAC; invalid → 401). Record `X-Shopify-Webhook-Id` in `ProcessedWebhook`
  (unique); duplicates return 200 without reprocessing. Prune records older than 30 days.
- **Uploads:** allow-list types (D9), size ≤ 200,000,000 bytes, rights confirmation, plan limits and a pending-upload cap,
  all before a one-time Stream upload URL is created server-side (`maxDurationSeconds: 180`, ~30 min expiry). Never accept a
  shop id, Stream uid or upload destination from the client.
- **Cloudflare credentials:** `CLOUDFLARE_STREAM_API_TOKEN`, the signing key and the webhook secret exist only in server
  env vars and `*.server.js` code. Never send them to the browser or storefront; never log them, one-time upload URLs,
  signed tokens or signed URLs (log video id, uid and state only).
- **Stream webhook:** verify `Webhook-Signature` (HMAC-SHA256 of `time + "." + rawBody` with `CLOUDFLARE_STREAM_WEBHOOK_SECRET`,
  constant-time compare, reject stale timestamps) → 401 on failure; then re-fetch the video from the API and run the
  ownership-checked sync. Handling is idempotent.
- **Playback:** every video is created with `requireSignedURLs: true`. Admin and storefront receive short-lived tokens
  (RS256 JWT signed locally with the Stream signing key, `exp` ≤ 24 h) only for the requesting shop's own videos; the
  storefront only for READY videos.
- **Public events endpoint:** schema validation, max 50 events per batch, rate limit per IP + shop (Postgres-backed),
  verify video/widget ids belong to the shop, drop unknown fields.
- **Secrets:** AES-256-GCM for social tokens, with `ENCRYPTION_KEY_VERSION` stored per row. Never log tokens, codes or URLs containing tokens.
- **Instagram OAuth:** signed state (shopId + nonce + expiry, HMAC with `OAUTH_STATE_SECRET`), nonce stored in `OAuthState`, single use, 10-minute expiry.
- **Scopes:** `read_products` only. Ask before adding any scope.
- **GDPR:** we store no customer PII. Analytics use an anonymous random session id. `customers/data_request` and
  `customers/redact` are acknowledged and logged; `shop/redact` deletes all shop rows and enqueues `stream-delete` for every
  stored `streamUid` plus a sweep of Stream videos with `creator = shopId`.

---

## 9. Storefront rules

- Budget: JS ≤ 25 KB gzipped, CSS ≤ 8 KB gzipped. Nothing render-blocking (`defer` scripts).
- Classes prefixed `.rl-`, CSS custom properties prefixed `--rl-`, `font-family: inherit`.
- Reserve space with `aspect-ratio` → zero layout shift. Skeletons while loading.
- Cards (D11): static poster (signed thumbnail URL) first; **animated thumbnail** preview only while ≥ 50 % visible, max 2 at
  once, never under `prefers-reduced-motion` or Save-Data, with the static poster as fallback on error. **No HLS/iframe in cards.**
- Player (D11): Cloudflare's embedded Stream player (iframe, signed token in the `src`) inside our own dialog; the Player
  API SDK is loaded only when the player opens. Pause on `visibilitychange`. Autoplay must be muted and may still be blocked
  (iOS) — always show the poster and a play control. Known overlay/swipe limitations: `docs/STREAM.md` §6.
- Cost: every video segment fetched is billed (delivered minutes); do not preload neighbouring videos' media.
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
DATABASE_URL  DIRECT_URL  DATABASE_URL_TEST  DIRECT_URL_TEST (optional)
CLOUDFLARE_ACCOUNT_ID  CLOUDFLARE_STREAM_API_TOKEN  CLOUDFLARE_STREAM_CUSTOMER_CODE
CLOUDFLARE_STREAM_SIGNING_KEY_ID  CLOUDFLARE_STREAM_SIGNING_KEY_JWK  CLOUDFLARE_STREAM_WEBHOOK_SECRET
ENCRYPTION_KEY  ENCRYPTION_KEY_VERSION  OAUTH_STATE_SECRET
FEATURE_INSTAGRAM  INSTAGRAM_APP_ID  INSTAGRAM_APP_SECRET  INSTAGRAM_REDIRECT_URI
SENTRY_DSN  NODE_ENV
```

`.env` is git-ignored. `.env.example` lists every variable with no values.
Removed 2026-10-13 (D10): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `MEDIA_BASE_URL`,
`FFMPEG_PATH`, `FFPROBE_PATH` (`.env.example` is updated on Day 3). Each environment has its own Cloudflare values (D12).

---

## 13. Commands

```
shopify app dev            # run app + tunnel (same as: npm run dev)
npm run stream:smoke -- --shop <store>.myshopify.com --file <video>   # real-account smoke test (Day 3; never in npm test)
npm run stream:webhook -- set --url <public-url>/webhooks/stream     # register the account's single webhook URL (Day 4)
npm run stream:signing-key -- --write-env   # create the Stream signing key once per account; saves it to .env, never prints it
npm test                   # vitest run (tests/setup.js redirects Prisma to DATABASE_URL_TEST)
npm run test:watch         # vitest watch mode
npm run test:db:migrate    # prisma migrate deploy against the test branch only (DIRECT_URL_TEST, else DATABASE_URL_TEST)
npm run seed -- --shop <store>.myshopify.com   # idempotent dev seed (refuses production / test branch / unknown shop)
npx prisma migrate dev     # create/apply migration (dev)
npx prisma studio          # inspect data
shopify app deploy         # push config + extensions
shopify app webhook trigger --topic <topic> --address <url>
```

(Adjust on Day 1 if the template's scripts differ.) The `stream:*` scripts are added on Days 3–4; there is no separate
worker process (D2/D5 amended) — pg-boss starts with the web server.

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
