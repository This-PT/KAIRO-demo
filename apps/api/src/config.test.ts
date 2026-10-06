import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createConnector, loadConfig } from "./config";

const base = {
  DATABASE_URL: "postgresql://x",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_TOKEN: "a-long-enough-token",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

describe("loadConfig", () => {
  it("loads valid config with defaults", () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({ port: 4000, webOrigin: "http://localhost:3000", demoMode: false, summarizeConcurrency: 2 });
  });
  it.each(["DATABASE_URL", "REDIS_URL", "ADMIN_TOKEN", "ENCRYPTION_KEY"])("fails without %s", (k) => {
    expect(() => loadConfig({ ...base, [k]: "" })).toThrow(new RegExp(k));
  });
  it("rejects an ENCRYPTION_KEY that is not 32 bytes", () => {
    expect(() => loadConfig({ ...base, ENCRYPTION_KEY: Buffer.from("short").toString("base64") })).toThrow(/ENCRYPTION_KEY/);
  });
  it("rejects short admin tokens", () => {
    expect(() => loadConfig({ ...base, ADMIN_TOKEN: "short" })).toThrow(/ADMIN_TOKEN/);
  });
  it("parses DEMO_MODE and numeric settings", () => {
    expect(loadConfig({ ...base, DEMO_MODE: "true", PORT: "5000", SUMMARIZE_CONCURRENCY: "4" })).toMatchObject({ demoMode: true, port: 5000, summarizeConcurrency: 4 });
  });
});

describe("demo hardening settings", () => {
  it("are off by default", () => {
    expect(loadConfig(base)).toMatchObject({ readOnly: false, chatDailyLimit: undefined });
  });
  it("parse DEMO_READONLY and CHAT_DAILY_LIMIT", () => {
    expect(loadConfig({ ...base, DEMO_READONLY: "true", CHAT_DAILY_LIMIT: "50" })).toMatchObject({ readOnly: true, chatDailyLimit: 50 });
  });
  it("only the exact string true turns read-only on", () => {
    expect(loadConfig({ ...base, DEMO_READONLY: "yes" }).readOnly).toBe(false);
  });
});

describe("createConnector", () => {
  it("uses fixtures in demo mode even if Jira credentials are present", () => {
    const r = createConnector({ demoMode: true }, { JIRA_BASE_URL: "https://x.atlassian.net", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t" });
    expect(r.info).toEqual({ mode: "demo", baseUrl: "fixtures" });
  });
  it("uses Jira when all credentials are present and demo mode is off", () => {
    const r = createConnector({ demoMode: false }, { JIRA_BASE_URL: "https://x.atlassian.net/", JIRA_EMAIL: "a@b.c", JIRA_API_TOKEN: "t" });
    expect(r.info).toEqual({ mode: "jira", baseUrl: "https://x.atlassian.net" });
  });
  it("fails loudly (no silent fixture fallback) when demo is off and credentials are missing", () => {
    expect(() => createConnector({ demoMode: false }, { JIRA_BASE_URL: "https://x.atlassian.net" })).toThrow(/JIRA_EMAIL|JIRA_API_TOKEN/);
  });
});

describe("demo dataset", () => {
  it("defaults to the basic dataset and accepts showcase", () => {
    expect(loadConfig(base).demoDataset).toBe("basic");
    expect(loadConfig({ ...base, DEMO_DATASET: "showcase" }).demoDataset).toBe("showcase");
    expect(loadConfig({ ...base, DEMO_DATASET: "whatever" }).demoDataset).toBe("basic");
  });
  it("demo mode serves the showcase project when asked", async () => {
    const r = createConnector({ demoMode: true, demoDataset: "showcase" }, {});
    expect(await r.connector.listProjects()).toEqual([{ key: "SHOP", name: "Shopfront" }]);
    expect(r.info).toEqual({ mode: "demo", baseUrl: "fixtures" });
  });
  it("demo mode serves the basic project by default", async () => {
    expect(await createConnector({ demoMode: true }, {}).connector.listProjects()).toEqual([{ key: "HND", name: "Handover Demo" }]);
  });
});

describe("Redis is optional for the read-only demo", () => {
  const { REDIS_URL: _drop, ...noRedis } = base;
  it("is still required for a normal deployment", () => {
    expect(() => loadConfig(noRedis)).toThrow(/REDIS_URL/);
  });
  it("can be left out when the API is read-only (no background jobs can be triggered)", () => {
    const c = loadConfig({ ...noRedis, DEMO_READONLY: "true" });
    expect(c.readOnly).toBe(true);
    expect(c.redisUrl).toBeUndefined();
  });
  it("is still used when provided", () => {
    expect(loadConfig({ ...base, DEMO_READONLY: "true" }).redisUrl).toBe("redis://localhost:6379");
  });
});
