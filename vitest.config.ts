import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./scripts/test-db";

const base = process.env.DATABASE_URL;

export default defineConfig({
  test: {
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    // DB-backed tests share one Postgres, so run test files one at a time.
    fileParallelism: false,
    globalSetup: ["./vitest.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // Tests use their own database (<name>_test), never the real one.
    env: base ? { DATABASE_URL: testDatabaseUrl(base) } : {},
  },
  esbuild: { jsx: "automatic" },
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/", import.meta.url)) }] },
});
