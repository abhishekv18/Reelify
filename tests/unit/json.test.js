import { describe, expect, it } from "vitest";
import { toJsonSafe } from "../../app/lib/json.js";

describe("toJsonSafe", () => {
  it("serializes BigInt values as strings, recursively", () => {
    const value = {
      id: 9007199254740993n,
      nested: { ids: [1n, 2n], name: "x", count: 3 },
      at: new Date("2026-10-13T00:00:00.000Z"),
      missing: null,
    };
    const safe = toJsonSafe(value);
    expect(safe).toEqual({
      id: "9007199254740993",
      nested: { ids: ["1", "2"], name: "x", count: 3 },
      at: "2026-10-13T00:00:00.000Z",
      missing: null,
    });
    expect(() => JSON.stringify(safe)).not.toThrow();
  });
});
