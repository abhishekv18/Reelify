import { describe, expect, it } from "vitest";
import {
  databaseIdentity,
  resolveTestDatabaseEnv,
  UNCONFIGURED_DB_URL,
} from "../helpers/test-env.js";

const MAIN_POOLED =
  "postgresql://u:p@ep-main-123-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";
const MAIN_DIRECT =
  "postgresql://u:p@ep-main-123.us-east-2.aws.neon.tech/neondb?sslmode=require";
const TEST_BRANCH =
  "postgresql://u:p@ep-test-456.us-east-2.aws.neon.tech/neondb?sslmode=require";

describe("resolveTestDatabaseEnv", () => {
  it("uses the test branch for both URLs when configured", () => {
    const result = resolveTestDatabaseEnv({
      DATABASE_URL: MAIN_POOLED,
      DIRECT_URL: MAIN_DIRECT,
      DATABASE_URL_TEST: TEST_BRANCH,
    });
    expect(result).toEqual({
      configured: true,
      DATABASE_URL: TEST_BRANCH,
      DIRECT_URL: TEST_BRANCH,
    });
  });

  it("never falls back to DATABASE_URL when the test URL is missing", () => {
    const result = resolveTestDatabaseEnv({
      DATABASE_URL: MAIN_POOLED,
      DIRECT_URL: MAIN_DIRECT,
    });
    expect(result.configured).toBe(false);
    expect(result.DATABASE_URL).toBe(UNCONFIGURED_DB_URL);
    expect(result.DIRECT_URL).toBe(UNCONFIGURED_DB_URL);
  });

  it("refuses a test URL that points at the main database (pooled or direct)", () => {
    expect(() =>
      resolveTestDatabaseEnv({
        DATABASE_URL: MAIN_POOLED,
        DIRECT_URL: MAIN_DIRECT,
        DATABASE_URL_TEST: MAIN_DIRECT,
      }),
    ).toThrow(/same database/);
  });
});

describe("test process environment (tests/setup.js)", () => {
  it("does not expose the main database to tests", () => {
    const mainIds = globalThis.__REELIFY_MAIN_DB_IDS__;
    expect(Array.isArray(mainIds)).toBe(true);

    for (const key of ["DATABASE_URL", "DIRECT_URL"]) {
      expect(mainIds).not.toContain(databaseIdentity(process.env[key]));
    }
    if (!process.env.REELIFY_TEST_DB) {
      expect(process.env.DATABASE_URL).toBe(UNCONFIGURED_DB_URL);
    }
  });
});

describe("resolveTestDatabaseEnv with DIRECT_URL_TEST", () => {
  const TEST_POOLED =
    "postgresql://u:p@ep-test-456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require";

  it("uses DIRECT_URL_TEST for migrations and the pooled URL for queries", () => {
    const result = resolveTestDatabaseEnv({
      DATABASE_URL: MAIN_POOLED,
      DIRECT_URL: MAIN_DIRECT,
      DATABASE_URL_TEST: TEST_POOLED,
      DIRECT_URL_TEST: TEST_BRANCH,
    });
    expect(result.DATABASE_URL).toBe(TEST_POOLED);
    expect(result.DIRECT_URL).toBe(TEST_BRANCH);
  });

  it("refuses a DIRECT_URL_TEST that points at the main database", () => {
    expect(() =>
      resolveTestDatabaseEnv({
        DATABASE_URL: MAIN_POOLED,
        DIRECT_URL: MAIN_DIRECT,
        DATABASE_URL_TEST: TEST_POOLED,
        DIRECT_URL_TEST: MAIN_DIRECT,
      }),
    ).toThrow(/same database/);
  });

  it("refuses a DIRECT_URL_TEST on a different branch than DATABASE_URL_TEST", () => {
    expect(() =>
      resolveTestDatabaseEnv({
        DATABASE_URL: MAIN_POOLED,
        DIRECT_URL: MAIN_DIRECT,
        DATABASE_URL_TEST: TEST_POOLED,
        DIRECT_URL_TEST:
          "postgresql://u:p@ep-other-789.us-east-2.aws.neon.tech/neondb",
      }),
    ).toThrow(/same test branch/);
  });
});
