import { execFileSync } from "node:child_process";
import { testDatabaseUrl } from "./scripts/test-db";

/** Creates (if needed) and migrates the separate test database before any test runs. */
export default function setup() {
  const base = process.env.DATABASE_URL;
  if (!base) return; // the per-file guard explains how to run the tests
  execFileSync("pnpm", ["--filter", "@kairo/db", "exec", "prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl(base) },
    stdio: "pipe",
    shell: true,
  });
}
