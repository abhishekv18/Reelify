# Reelify — Decisions

Source of truth for locked decisions. Changing a locked decision requires explicit approval (CLAUDE.md section 15).

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| D1 | Billing via **Shopify App Pricing** (hosted plan selection page). No Billing API charge creation. | Locked | Plan-detection method to be verified against current docs on Day 13. |
| D2 | Background jobs via **pg-boss** on the same PostgreSQL database. No Redis. | Locked | Uses its own `pgboss` schema; connects with `DIRECT_URL`. Wired on Day 4. |
| D3 | TikTok removed from v1. | Locked | Official API offers embeds, not video files. |
| D4 | Instagram import behind `FEATURE_INSTAGRAM` (default `false`). App Store submission upload-only unless Meta approval is complete. | Locked | |
| D5 | Hosting on **Render**: one Web Service + one Background Worker, Docker images with system ffmpeg. | Locked | Template Dockerfile is web-only without ffmpeg; reworked Day 12 (CLAUDE.md conflict C9). |
| D6 | Revenue attribution deferred to v1.1. | Locked | No `orders/*` webhooks, no `read_orders`. |
| D7 | v1 storefront = carousel + product-page videos + player. | Locked | |
| D8 | Production media custom domain. | **PENDING** | All code reads `MEDIA_BASE_URL`; r2.dev allowed for local/dev only. Needed by Day 19. |
| D9 | Upload limits: MP4 / MOV / WebM, ≤ 200 MB, ≤ 3 minutes. Output: H.264/AAC MP4, max 720p, `+faststart`. | Locked | |

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
