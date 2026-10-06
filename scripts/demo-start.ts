import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

export interface Flags {
  readonly: boolean;
  mock: boolean;
}

/** Unknown flags are an error, so a typo such as --readonyl cannot silently start a writable demo. */
export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { readonly: false, mock: false };
  for (const a of argv) {
    if (a === "--readonly") flags.readonly = true;
    else if (a === "--mock") flags.mock = true;
    else throw new Error(`Unknown option ${a}. Valid options: --readonly (visitors cannot change anything), --mock (offline summaries, no AI cost)`);
  }
  return flags;
}

export const apiEnv = (f: Flags): Record<string, string> => ({
  DEMO_MODE: "true",
  DEMO_DATASET: "showcase",
  ...(f.readonly ? { DEMO_READONLY: "true" } : {}),
});

export const loaderEnv = (f: Flags): Record<string, string> => (f.mock ? { LLM_PROVIDER: "mock" } : {});

// ---------------------------------------------------------------- CLI
const run = (cmd: string, env: Record<string, string> = {}) => spawnSync(cmd, { shell: true, stdio: "inherit", env: { ...process.env, ...env } }).status === 0;
const portBusy = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.on("connect", () => (s.destroy(), resolve(true)));
    s.on("error", () => resolve(false));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log(`Starting the Shopfront demo${flags.readonly ? " (read-only)" : ""}${flags.mock ? " with offline summaries" : ""}...\n`);

  for (const port of [3000, 4000]) {
    if (await portBusy(port)) throw new Error(`Port ${port} is already in use. Stop the old servers first (see the README troubleshooting section).`);
  }

  console.log("1/4 Starting Postgres and Redis (Docker Desktop must be running)...");
  if (!run("docker compose up -d")) throw new Error("docker compose failed. Is Docker Desktop running?");
  for (let i = 0; i < 30 && !run("docker compose exec -T postgres pg_isready -U handover > NUL 2>&1 || docker compose exec -T postgres pg_isready -U handover > /dev/null 2>&1"); i++) await sleep(1000);

  console.log("\n2/4 Applying database migrations...");
  if (!run("pnpm db:deploy")) throw new Error("Migrations failed.");

  console.log("\n3/4 Loading the demo data" + (flags.mock ? " (offline summaries)" : " (summaries by your configured AI model; a few cents)") + "...");
  if (!run("pnpm demo:showcase", loaderEnv(flags))) throw new Error("Loading the demo data failed.");

  console.log("\n4/4 Starting the API and the web app...");
  const children = [spawn("pnpm api", { shell: true, stdio: "inherit", env: { ...process.env, ...apiEnv(flags) } }), spawn("pnpm web", { shell: true, stdio: "inherit", env: process.env })];
  const stop = () => {
    for (const c of children) {
      if (!c.pid) continue;
      if (process.platform === "win32") spawnSync(`taskkill /PID ${c.pid} /T /F`, { shell: true, stdio: "ignore" });
      else c.kill("SIGTERM");
    }
  };
  process.on("SIGINT", () => (stop(), process.exit(0)));
  process.on("SIGTERM", () => (stop(), process.exit(0)));
  children.forEach((c) => c.on("exit", (code) => code !== 0 && (console.error("A server stopped unexpectedly; shutting down."), stop(), process.exit(1))));

  await sleep(8000);
  console.log("\n  Open http://localhost:3000   (Ctrl+C stops everything)\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`\n${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
