import { describe, expect, it } from "vitest";
import { buildEnv } from "./setup-env";

const example = `# db\nDATABASE_URL=postgresql://x\nENCRYPTION_KEY=\nADMIN_TOKEN=\nDEMO_MODE=true\nNEW_THING=hello\n`;
let n = 0;
const gen = { key: () => `KEY${++n}`, token: () => `TOKEN${++n}` };
const parse = (t: string) => Object.fromEntries(t.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]));

describe("buildEnv", () => {
  it("creates a new env from the example and generates the two secrets", () => {
    const r = buildEnv(example, null, gen);
    const v = parse(r.text);
    expect(v.DATABASE_URL).toBe("postgresql://x");
    expect(v.ENCRYPTION_KEY).toMatch(/^KEY/);
    expect(v.ADMIN_TOKEN).toMatch(/^TOKEN/);
    expect(r.changes.join()).toMatch(/ENCRYPTION_KEY/);
  });

  it("never overwrites values the user already set", () => {
    const existing = "DATABASE_URL=mine\nENCRYPTION_KEY=keepme\nADMIN_TOKEN=keep-this-token\nDEMO_MODE=false\nNEW_THING=hello\n";
    const r = buildEnv(example, existing, gen);
    expect(r.text).toBe(existing);
    expect(r.changes).toEqual([]);
  });

  it("fills blank secrets in an existing file without touching other lines", () => {
    const existing = "DATABASE_URL=mine\nENCRYPTION_KEY=\nADMIN_TOKEN=\nDEMO_MODE=false\nNEW_THING=hello\n";
    const v = parse(buildEnv(example, existing, gen).text);
    expect(v.DATABASE_URL).toBe("mine");
    expect(v.DEMO_MODE).toBe("false");
    expect(v.ENCRYPTION_KEY).toMatch(/^KEY/);
    expect(v.ADMIN_TOKEN).toMatch(/^TOKEN/);
  });

  it("appends settings that exist in the example but not in the user's file", () => {
    const r = buildEnv(example, "DATABASE_URL=mine\nENCRYPTION_KEY=k\nADMIN_TOKEN=t\n", gen);
    expect(parse(r.text).NEW_THING).toBe("hello");
    expect(parse(r.text).DEMO_MODE).toBe("true");
    expect(r.changes.join()).toMatch(/NEW_THING/);
  });

  it("is idempotent", () => {
    const first = buildEnv(example, null, gen).text;
    const second = buildEnv(example, first, gen);
    expect(second.text).toBe(first);
    expect(second.changes).toEqual([]);
  });

  it("never reports secret values in its change log", () => {
    const r = buildEnv(example, null, gen);
    expect(r.changes.join()).not.toMatch(/KEY\d|TOKEN\d/);
  });

  it("the real generators produce a 32-byte key and a 12+ char token", async () => {
    const { defaultGenerators } = await import("./setup-env");
    expect(Buffer.from(defaultGenerators.key(), "base64")).toHaveLength(32);
    expect(defaultGenerators.token().length).toBeGreaterThanOrEqual(12);
  });
});
