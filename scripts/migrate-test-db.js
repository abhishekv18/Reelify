// Applies Prisma migrations to the test branch only (DIRECT_URL_TEST if set, else DATABASE_URL_TEST).
// Usage: npm run test:db:migrate
import { spawnSync } from "node:child_process";
import { loadEnv } from "vite";
import { resolveTestDatabaseEnv } from "../tests/helpers/test-env.js";

const env = { ...loadEnv("test", process.cwd(), ""), ...process.env };
const resolved = resolveTestDatabaseEnv(env);

if (!resolved.configured) {
  console.error("DATABASE_URL_TEST is not set. Add the Neon test branch URL to .env first.");
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    DATABASE_URL: resolved.DATABASE_URL,
    DIRECT_URL: resolved.DIRECT_URL,
  },
});
process.exit(result.status ?? 1);
