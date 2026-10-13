import { afterAll, describe, expect, it } from "vitest";

const hasTestDb = Boolean(process.env.REELIFY_TEST_DB);

// Requires DATABASE_URL_TEST (separate Neon branch). Skipped when it is not set.
describe.skipIf(!hasTestDb)("test database smoke", () => {
  /** @type {import("@prisma/client").PrismaClient} */
  let prisma;

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("connects to the test branch", async () => {
    prisma = (await import("../../app/db.server.js")).default;
    const rows = await prisma.$queryRaw`SELECT 1 AS ok`;
    expect(rows[0].ok).toBe(1);
  });
});
