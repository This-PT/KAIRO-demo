import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkEnv, childEnvs, withDemoDefaults } from "./render-start";

const good = {
  DATABASE_URL: "postgresql://u:p@db:5432/handover",
  ADMIN_TOKEN: "a-long-enough-admin-token",
  ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  APP_PASSWORD: "a-long-password",
};

describe("checkEnv", () => {
  it("accepts a complete configuration", () => expect(checkEnv(good)).toEqual([]));
  it.each(["DATABASE_URL", "ADMIN_TOKEN", "ENCRYPTION_KEY", "APP_PASSWORD"])("requires %s", (k) => {
    expect(checkEnv({ ...good, [k]: "" }).join(" ")).toContain(k);
  });
  it("requires APP_PASSWORD even though local development does not (this server is public)", () => {
    expect(checkEnv({ ...good, APP_PASSWORD: undefined }).join(" ")).toMatch(/APP_PASSWORD/);
  });
  it("rejects an ENCRYPTION_KEY that is not 32 bytes and a short ADMIN_TOKEN", () => {
    expect(checkEnv({ ...good, ENCRYPTION_KEY: "short" }).join(" ")).toMatch(/ENCRYPTION_KEY/);
    expect(checkEnv({ ...good, ADMIN_TOKEN: "short" }).join(" ")).toMatch(/ADMIN_TOKEN/);
  });
  it("rejects a short APP_PASSWORD", () => expect(checkEnv({ ...good, APP_PASSWORD: "abc" }).join(" ")).toMatch(/APP_PASSWORD/));
  it("never puts secret values in its messages", () => {
    const msg = checkEnv({ ...good, ENCRYPTION_KEY: "SecretKeyValue", ADMIN_TOKEN: "tinySecret", APP_PASSWORD: "pw" }).join(" ");
    for (const s of ["SecretKeyValue", "tinySecret", "pw-secret"]) expect(msg).not.toContain(s);
  });
});

describe("withDemoDefaults", () => {
  it("makes the deployment a read-only demo of the showcase data unless told otherwise", () => {
    expect(withDemoDefaults({})).toMatchObject({ DEMO_MODE: "true", DEMO_DATASET: "showcase", DEMO_READONLY: "true", DEMO_SEED: "true", NODE_ENV: "production" });
  });
  it("keeps values that were set explicitly", () => {
    expect(withDemoDefaults({ DEMO_READONLY: "false", CHAT_DAILY_LIMIT: "5" })).toMatchObject({ DEMO_READONLY: "false", CHAT_DAILY_LIMIT: "5" });
  });
  it("applies a sensible chat budget by default", () => expect(Number(withDemoDefaults({}).CHAT_DAILY_LIMIT)).toBeGreaterThan(0));
});

describe("childEnvs", () => {
  it("runs the API privately on 4000 and gives the web app the platform's public port", () => {
    const { api, web } = childEnvs({ ...good, PORT: "10000" });
    expect(api.PORT).toBe("4000");
    expect(web.PORT).toBe("10000");
    expect(web.API_URL).toBe("http://127.0.0.1:4000");
  });
  it("defaults the public port to 10000", () => expect(childEnvs(good).web.PORT).toBe("10000"));
  it("shares the secrets both processes need", () => {
    const { api, web } = childEnvs(good);
    expect(api.ADMIN_TOKEN).toBe(good.ADMIN_TOKEN);
    expect(web.ADMIN_TOKEN).toBe(good.ADMIN_TOKEN);
    expect(web.APP_PASSWORD).toBe(good.APP_PASSWORD);
  });
  it("does not give the public web process the encryption key or database credentials", () => {
    const { web } = childEnvs(good);
    expect(web.ENCRYPTION_KEY).toBeUndefined();
    expect(web.DATABASE_URL).toBeUndefined();
  });
});

import { resolveLlm } from "./render-start";

describe("resolveLlm (a missing OpenAI key must not stop the deployment from starting)", () => {
  it("keeps OpenAI when a key is present", () => {
    const r = resolveLlm({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test-1234567890abcdef", OPENAI_MODEL: "m" });
    expect(r.env.LLM_PROVIDER).toBe("openai");
    expect(r.notice).toBeNull();
  });
  it("falls back to the offline provider when the key is missing or blank, and says so", () => {
    for (const key of [undefined, "", "   "]) {
      const r = resolveLlm({ LLM_PROVIDER: "openai", OPENAI_API_KEY: key });
      expect(r.env.LLM_PROVIDER).toBe("mock");
      expect(r.notice).toMatch(/OPENAI_API_KEY/);
      expect(r.notice).toMatch(/offline/i);
    }
  });
  it("falls back when the model name is missing too", () => {
    const r = resolveLlm({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "sk-test-1234567890abcdef", OPENAI_MODEL: "" });
    expect(r.env.LLM_PROVIDER).toBe("mock");
    expect(r.notice).toMatch(/OPENAI_MODEL/);
  });
  it("leaves other providers alone", () => {
    expect(resolveLlm({ LLM_PROVIDER: "mock" }).env.LLM_PROVIDER).toBe("mock");
    expect(resolveLlm({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }).env.LLM_PROVIDER).toBe("anthropic");
  });
  it("treats an unset provider as the offline default", () => {
    expect(resolveLlm({}).notice).toBeNull();
  });
  it("never puts the key in the notice and does not change other settings", () => {
    const r = resolveLlm({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "", ADMIN_TOKEN: "keepme-1234567890" });
    expect(r.env.ADMIN_TOKEN).toBe("keepme-1234567890");
  });
});
