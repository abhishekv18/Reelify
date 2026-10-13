/**
 * Placeholder URL used when DATABASE_URL_TEST is not configured. It points at a
 * port nothing listens on, so any accidental DB access fails fast instead of
 * reaching the development/production database.
 */
export const UNCONFIGURED_DB_URL =
  "postgresql://reelify-test-db-not-configured@127.0.0.1:1/none";

/**
 * Identifies a Postgres database by host (Neon "-pooler" suffix removed) and name,
 * so the pooled and direct URLs of the same branch compare as equal.
 * @param {string | undefined} url
 * @returns {string | null}
 */
export function databaseIdentity(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.hostname.replace("-pooler", "")}${u.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Decides which database URLs the test process may use.
 * Tests must never run against DATABASE_URL / DIRECT_URL.
 * @param {Record<string, string | undefined>} env
 * @returns {{ configured: boolean, DATABASE_URL: string, DIRECT_URL: string }}
 */
export function resolveTestDatabaseEnv(env) {
  const testUrl = env.DATABASE_URL_TEST;

  if (!testUrl) {
    return {
      configured: false,
      DATABASE_URL: UNCONFIGURED_DB_URL,
      DIRECT_URL: UNCONFIGURED_DB_URL,
    };
  }

  // Optional direct (unpooled) URL of the same test branch, used for migrations.
  const directTestUrl = env.DIRECT_URL_TEST || testUrl;

  for (const [name, url] of [
    ["DATABASE_URL_TEST", testUrl],
    ["DIRECT_URL_TEST", directTestUrl],
  ]) {
    const testId = databaseIdentity(url);
    if (!testId) {
      throw new Error(`${name} is not a valid connection URL.`);
    }
    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      if (databaseIdentity(env[key]) === testId) {
        throw new Error(
          `${name} points at the same database as ${key}. ` +
            "Use a separate Neon branch for tests.",
        );
      }
    }
  }

  if (databaseIdentity(directTestUrl) !== databaseIdentity(testUrl)) {
    throw new Error(
      "DIRECT_URL_TEST must point at the same test branch as DATABASE_URL_TEST.",
    );
  }

  return { configured: true, DATABASE_URL: testUrl, DIRECT_URL: directTestUrl };
}
