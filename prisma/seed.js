/**
 * Development seed: creates (or reuses) the Shop row for your dev store. Idempotent.
 *
 *   npm run seed -- --shop your-store.myshopify.com [--allow-no-session]
 *
 * Safety gates (all must pass):
 *   1. NODE_ENV is not "production".
 *   2. --shop is a valid *.myshopify.com domain.
 *   3. The target database is not the test branch (DATABASE_URL_TEST / DIRECT_URL_TEST).
 *   4. An offline Session for that shop already exists in the target database — proof that this is
 *      the dev database this app was installed against. Override with --allow-no-session.
 * Seeds no tokens, no customer data and no videos.
 */
import { loadEnv } from "vite";
import { databaseIdentity } from "../tests/helpers/test-env.js";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** @param {string} message */
function fail(message) {
  console.error(`Seed refused: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { shop: undefined, allowNoSession: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--shop") args.shop = argv[i + 1];
    else if (argv[i].startsWith("--shop=")) args.shop = argv[i].slice("--shop=".length);
    else if (argv[i] === "--allow-no-session") args.allowNoSession = true;
  }
  return args;
}

async function main() {
  const env = { ...loadEnv("development", process.cwd(), ""), ...process.env };
  const { shop, allowNoSession } = parseArgs(process.argv.slice(2));

  if (env.NODE_ENV === "production") fail("NODE_ENV is production.");
  if (!shop || !SHOP_DOMAIN.test(shop)) {
    fail("pass --shop <your-dev-store>.myshopify.com");
  }
  if (!env.DATABASE_URL) fail("DATABASE_URL is not set.");

  const targetId = databaseIdentity(env.DATABASE_URL);
  const testIds = [env.DATABASE_URL_TEST, env.DIRECT_URL_TEST].map(databaseIdentity).filter(Boolean);
  if (!targetId) fail("DATABASE_URL is not a valid connection URL.");
  if (testIds.includes(targetId)) fail("DATABASE_URL points at the test branch.");

  // Make sure Prisma uses exactly the database we checked.
  process.env.DATABASE_URL = env.DATABASE_URL;
  const { default: prisma } = await import("../app/db.server.js");
  const { upsertShopForInstall } = await import("../app/repositories/shop.server.js");

  try {
    // Session is the template's table (not app data), so reading it directly is allowed.
    const session = await prisma.session.findFirst({
      where: { shop, isOnline: false },
      select: { id: true },
    });
    if (!session && !allowNoSession) {
      fail(
        `no offline session for ${shop} in ${new URL(env.DATABASE_URL).hostname}. ` +
          "Install the app on that store first, or pass --allow-no-session.",
      );
    }

    const row = await upsertShopForInstall(shop);
    console.log(`Seeded shop ${row.shopDomain} (id ${row.id}) in ${new URL(env.DATABASE_URL).hostname}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("Seed failed:", error?.name ?? "Error", error?.code ?? "");
  process.exit(1);
});
