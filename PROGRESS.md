# Reelify — Progress

Status legend: ✅ done · 🟡 in progress / partially verified · ⬜ not started

## 20-day plan (from PROMPTS.md)

### Phase A — Core MVP
| Day | Scope | Status |
|-----|-------|--------|
| 1 | Inspect template, PostgreSQL (Neon), Vitest, env example, docs | ✅ |
| 2 | v1 Prisma schema, repositories + tenant isolation, webhook idempotency, crypto, seed | ✅ |
| 3 | R2 storage service, validated upload flow (presign → complete) | ⬜ |
| 4 | pg-boss worker, process-video pipeline, stale-upload cleanup, retry | ⬜ |
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
| 16 | Instagram import into pipeline (flagged) | ⬜ |

### Phase C — Polish & submit
| Day | Scope | Status |
|-----|-------|--------|
| 17 | Stretch widgets (only if MVP gate + Phase B pass) | ⬜ |
| 18 | Design, accessibility, performance pass | ⬜ |
| 19 | Production deploy (needs D8) | ⬜ |
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
