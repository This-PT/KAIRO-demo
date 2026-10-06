import { FixtureConnector, JiraClient, JiraConnector, type Connector } from "@kairo/connectors";

type Env = Record<string, string | undefined>;

export interface Config {
  port: number;
  webOrigin: string;
  databaseUrl: string;
  redisUrl: string | undefined;
  adminToken: string;
  encryptionKey: string;
  demoMode: boolean;
  summarizeConcurrency: number;
  /** Public demo: visitors can read and chat, but cannot change anything */
  readOnly: boolean;
  chatDailyLimit: number | undefined;
  /** Which fake data demo mode serves */
  demoDataset: "basic" | "showcase";
}

export function loadConfig(env: Env = process.env): Config {
  const need = (k: string) => {
    const v = env[k]?.trim();
    if (!v) throw new Error(`${k} is required`);
    return v;
  };
  const adminToken = need("ADMIN_TOKEN");
  if (adminToken.length < 12) throw new Error("ADMIN_TOKEN must be at least 12 characters");
  const encryptionKey = need("ENCRYPTION_KEY");
  if (Buffer.from(encryptionKey, "base64").length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  const readOnly = env.DEMO_READONLY === "true";

  return {
    port: Number(env.PORT ?? 4000),
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    databaseUrl: need("DATABASE_URL"),
    // A read-only demo cannot trigger background jobs, so it can run without Redis (one less service to host).
    redisUrl: readOnly ? env.REDIS_URL?.trim() || undefined : need("REDIS_URL"),
    adminToken,
    encryptionKey,
    demoMode: env.DEMO_MODE === "true",
    summarizeConcurrency: Number(env.SUMMARIZE_CONCURRENCY ?? 2),
    readOnly,
    chatDailyLimit: env.CHAT_DAILY_LIMIT ? Number(env.CHAT_DAILY_LIMIT) : undefined,
    demoDataset: env.DEMO_DATASET === "showcase" ? "showcase" : "basic",
  };
}

export interface ConnectionInfo {
  mode: "demo" | "jira";
  baseUrl: string;
}

/** Demo mode serves fixtures. Otherwise Jira credentials are mandatory: no silent fallback to fake data. */
export function createConnector(c: { demoMode: boolean; demoDataset?: "basic" | "showcase" }, env: Env = process.env): { connector: Connector; info: ConnectionInfo } {
  if (c.demoMode) return { connector: c.demoDataset === "showcase" ? FixtureConnector.showcase() : new FixtureConnector(), info: { mode: "demo", baseUrl: "fixtures" } };
  const missing = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing ${missing.join(", ")} (or set DEMO_MODE=true to use fixtures)`);
  const client = new JiraClient({ baseUrl: env.JIRA_BASE_URL!, email: env.JIRA_EMAIL!, apiToken: env.JIRA_API_TOKEN! });
  return { connector: new JiraConnector(client), info: { mode: "jira", baseUrl: client.baseUrl } };
}
