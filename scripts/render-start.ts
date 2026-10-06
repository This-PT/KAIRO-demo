import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

type Env = Record<string, string | undefined>;
const MIN_PASSWORD = 8;

/** Problems that would make the deployment unsafe or unable to start. Messages never contain secret values. */
export function checkEnv(env: Env): string[] {
  const problems: string[] = [];
  if (!env.DATABASE_URL?.trim()) problems.push("DATABASE_URL is not set");
  if ((env.ADMIN_TOKEN?.trim().length ?? 0) < 12) problems.push("ADMIN_TOKEN must be set and at least 12 characters");
  if (Buffer.from(env.ENCRYPTION_KEY ?? "", "base64").length !== 32) problems.push("ENCRYPTION_KEY must be set to 32 random bytes, base64-encoded");
  // Local development may run without a password; a public server must not.
  if ((env.APP_PASSWORD?.length ?? 0) < MIN_PASSWORD) problems.push(`APP_PASSWORD must be set (at least ${MIN_PASSWORD} characters): this server is public`);
  return problems;
}

/** A deployment is a read-only demo of the showcase data unless the environment says otherwise. */
export function withDemoDefaults(env: Env): Record<string, string | undefined> {
  const set = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  return { DEMO_MODE: "true", DEMO_DATASET: "showcase", DEMO_READONLY: "true", DEMO_SEED: "true", CHAT_DAILY_LIMIT: "50", NODE_ENV: "production", ...set };
}

/**
 * The API refuses to start with LLM_PROVIDER=openai and no key. For a deployment that would take the whole demo down,
 * so a missing key (or model) switches chat to the offline provider instead, and says so in the log.
 */
export function resolveLlm(env: Env): { env: Env; notice: string | null } {
  if ((env.LLM_PROVIDER ?? "").toLowerCase() !== "openai") return { env, notice: null };
  const missing = [!env.OPENAI_API_KEY?.trim() && "OPENAI_API_KEY", !env.OPENAI_MODEL?.trim() && "OPENAI_MODEL"].filter(Boolean);
  if (missing.length === 0) return { env, notice: null };
  return {
    env: { ...env, LLM_PROVIDER: "mock" },
    notice: `${missing.join(" and ")} not set: Ask AI runs in offline mode (it quotes the closest ticket instead of writing an answer). Set ${missing.join(" and ")} in the service settings for real answers.`,
  };
}

const definedOnly = (o: Env): Record<string, string> => Object.fromEntries(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined));

/**
 * The API runs privately on 4000; the web app takes the platform's public port.
 * The public web process gets only what it needs: it never sees the encryption key or the database credentials.
 */
export function childEnvs(env: Env): { api: Record<string, string>; web: Record<string, string> } {
  const api = definedOnly({ ...env, PORT: "4000" });
  const web = definedOnly({
    PATH: env.PATH,
    HOME: env.HOME,
    NODE_ENV: env.NODE_ENV ?? "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: env.PORT ?? "10000",
    API_URL: "http://127.0.0.1:4000",
    ADMIN_TOKEN: env.ADMIN_TOKEN,
    APP_PASSWORD: env.APP_PASSWORD,
  });
  return { api, web };
}

// ------------------------------------------------------------------ CLI
const root = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForApi(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch("http://127.0.0.1:4000/health")).ok) return;
    } catch {}
    await sleep(1000);
  }
  throw new Error("The API did not become healthy within 90 seconds.");
}

async function main() {
  const llm = resolveLlm(withDemoDefaults(process.env));
  const env = llm.env;
  if (llm.notice) console.warn(`[start] ${llm.notice}`);
  const problems = checkEnv(env);
  if (problems.length) {
    console.error(`Cannot start:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }

  const run = (label: string, args: string[], cwd = root) => {
    console.log(`[start] ${label}`);
    const r = spawnSync(process.execPath, args, { cwd, env: definedOnly(env), stdio: "inherit" });
    if (r.status !== 0) throw new Error(`${label} failed`);
  };
  const prisma = createRequire(`${root}packages/db/package.json`).resolve("prisma/build/index.js");
  run("applying database migrations", [prisma, "migrate", "deploy", "--schema", `${root}packages/db/prisma/schema.prisma`]);
  if (env.DEMO_SEED === "true") run("loading demo data if the database is empty", ["--import", "tsx", "apps/api/src/seed-cli.ts"]);

  const { api, web } = childEnvs(env);
  const children: ChildProcess[] = [];
  const stop = () => children.forEach((c) => c.kill("SIGTERM"));
  const fail = (name: string) => (code: number | null) => {
    console.error(`[start] ${name} exited (code ${code}); shutting down so the platform restarts it.`);
    stop();
    process.exit(1);
  };

  console.log("[start] starting the API");
  const apiProc = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], { cwd: root, env: api, stdio: "inherit" });
  apiProc.on("exit", fail("API"));
  children.push(apiProc);
  await waitForApi();

  console.log(`[start] starting the web app on port ${web.PORT}`);
  const next = createRequire(`${root}apps/web/package.json`).resolve("next/dist/bin/next");
  const webProc = spawn(process.execPath, [next, "start", "-p", web.PORT!, "-H", "0.0.0.0"], { cwd: `${root}apps/web`, env: web, stdio: "inherit" });
  webProc.on("exit", fail("web app"));
  children.push(webProc);

  for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stop(), process.exit(0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(`[start] ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
