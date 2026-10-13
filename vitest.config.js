import { defineConfig } from "vitest/config";

// Separate from vite.config.js on purpose: the React Router Vite plugin is not
// needed (and gets in the way) for server service/unit/integration tests.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["tests/setup.js"],
    // Integration tests share one test database; run files sequentially.
    fileParallelism: false,
    // Integration tests talk to a remote Neon branch (~250 ms per round trip from local dev).
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
