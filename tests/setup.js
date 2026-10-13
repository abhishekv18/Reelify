import { loadEnv } from "vite";
import { databaseIdentity, resolveTestDatabaseEnv } from "./helpers/test-env.js";

// Load .env / .env.test (all keys, not only VITE_*); real env vars take precedence.
const fileEnv = loadEnv("test", process.cwd(), "");
const env = { ...fileEnv, ...process.env };

// Remember which databases are off-limits (host/db only, no credentials) so tests can assert on it.
globalThis.__REELIFY_MAIN_DB_IDS__ = [env.DATABASE_URL, env.DIRECT_URL]
  .map(databaseIdentity)
  .filter(Boolean);

// Point Prisma at the test branch only. Runs before any test file imports
// app/db.server.js, so the PrismaClient is created with these values.
const resolved = resolveTestDatabaseEnv(env);
process.env.DATABASE_URL = resolved.DATABASE_URL;
process.env.DIRECT_URL = resolved.DIRECT_URL;
process.env.REELIFY_TEST_DB = resolved.configured ? "1" : "";
