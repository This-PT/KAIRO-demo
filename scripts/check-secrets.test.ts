import { describe, expect, it } from "vitest";
import { findLeaks, isIgnored, secretsFromEnv } from "./check-secrets";

describe("secretsFromEnv", () => {
  it("picks real secret values from a .env file and skips blanks, placeholders and non-secrets", () => {
    const env = [
      "ADMIN_TOKEN=abcdef0123456789abcdef",
      "ENCRYPTION_KEY=c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTI=",
      "OPENAI_API_KEY=sk-proj-REALKEYVALUE1234567890",
      "JIRA_API_TOKEN=",
      "APP_PASSWORD=",
      "DEMO_MODE=true",
      "OPENAI_MODEL=gpt-6.1-sol",
      "DATABASE_URL=postgresql://handover:handover@127.0.0.1:5432/handover",
      "# ADMIN_TOKEN=commented-out-value-123456",
    ].join("\n");
    const s = secretsFromEnv(env);
    expect(s).toEqual(expect.arrayContaining(["abcdef0123456789abcdef", "c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0MTI=", "sk-proj-REALKEYVALUE1234567890"]));
    expect(s).not.toContain("true");
    expect(s).not.toContain("gpt-6.1-sol");
    expect(s.join()).not.toContain("commented-out");
  });
  it("includes a non-default database password but not the well-known local one", () => {
    expect(secretsFromEnv("DATABASE_URL=postgresql://u:SuperSecretDbPw@host:5432/db")).toContain("SuperSecretDbPw");
    expect(secretsFromEnv("DATABASE_URL=postgresql://handover:handover@127.0.0.1:5432/handover")).toEqual([]);
  });
  it("ignores values too short to be real secrets (they would match everywhere)", () => {
    expect(secretsFromEnv("ADMIN_TOKEN=short")).toEqual([]);
  });
});

describe("isIgnored", () => {
  const ignore = ["node_modules", ".env", ".next", "dist", "*.log", ".scratch"];
  it("skips ignored folders, files and extensions anywhere in the tree", () => {
    for (const p of ["node_modules/x/y.js", "apps/web/.next/server/a.js", ".env", "apps/api/.env", "a/b/debug.log", ".scratch/q.json", "dist/x.js"]) expect(isIgnored(p, ignore), p).toBe(true);
  });
  it("keeps real source files, including .env.example", () => {
    for (const p of ["README.md", "apps/api/src/app.ts", ".env.example", "fixtures/jira/HND-1.json"]) expect(isIgnored(p, ignore), p).toBe(false);
  });
});

describe("findLeaks", () => {
  const files = [
    { path: "README.md", content: "nothing here" },
    { path: "apps/api/src/oops.ts", content: 'const key = "sk-proj-REALKEYVALUE1234567890";' },
    { path: "docs/notes.md", content: "token abcdef0123456789abcdef was used" },
  ];
  it("reports which file contains which kind of secret, never the value", () => {
    const leaks = findLeaks(files, ["sk-proj-REALKEYVALUE1234567890", "abcdef0123456789abcdef"]);
    expect(leaks.map((l) => l.path).sort()).toEqual(["apps/api/src/oops.ts", "docs/notes.md"]);
    expect(JSON.stringify(leaks)).not.toContain("REALKEYVALUE");
    expect(JSON.stringify(leaks)).not.toContain("abcdef0123456789abcdef");
  });
  it("finds nothing in clean files", () => expect(findLeaks([files[0]!], ["sk-proj-REALKEYVALUE1234567890"])).toEqual([]));
});

import { findSecretShapes } from "./check-secrets";

// Built at runtime so this test file does not itself contain secret-shaped text.
const stripe = (n: number, p = "live") => ["sk", p, "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6".slice(0, n)].join("_");
const ghp = (n: number) => ["ghp", "abcdefghijklmnopqrstuvwxyz0123456789".slice(0, n)].join("_");
const pem = (kind = "RSA ") => `-----BEGIN ${kind}PRIVATE KEY-----`;

describe("findSecretShapes (strings that look like real keys, which GitHub's push protection blocks)", () => {
  const f = (content: string) => findSecretShapes([{ path: "x.ts", content }]);

  it("flags Stripe-style keys of 24+ characters, live and test", () => {
    expect(f(`key ${stripe(30)}`).map((l) => l.kind)).toEqual(["Stripe API key"]);
    expect(f(`key ${stripe(30, "test")}`).map((l) => l.kind)).toEqual(["Stripe API key"]);
  });
  it("accepts short obviously fake tokens, which the app's redaction still catches", () => {
    expect(f(`key ${stripe(12)}`)).toEqual([]);
  });
  it("flags GitHub-token-style strings of 36 characters but not shorter ones", () => {
    expect(f(ghp(36)).map((l) => l.kind)).toEqual(["GitHub token"]);
    expect(f(ghp(30))).toEqual([]);
  });
  it("flags AWS-style keys except the documented example key", () => {
    expect(f("AKIA" + "ABCDEFGHIJKLMNOP").map((l) => l.kind)).toEqual(["AWS access key"]);
    expect(f("AKIA" + "IOSFODNN7EXAMPLE")).toEqual([]);
  });
  it("flags private key blocks", () => {
    expect(f(pem()).map((l) => l.kind)).toEqual(["Private key"]);
    expect(f(pem("")).map((l) => l.kind)).toEqual(["Private key"]);
  });
  it("does not flag regular expressions or prose that merely mention key formats", () => {
    expect(f("const re = /sk_(live|test)_[0-9a-zA-Z]{24,}/; // Stripe keys look like sk_live_...")).toEqual([]);
    expect(f("-----BEGIN [A-Z ]*PRIVATE KEY-----")).toEqual([]);
  });
  it("reports each kind once per file and never includes the matched text", () => {
    const r = f(`${stripe(30)}\n${stripe(30)}\n${pem()}`);
    expect(r.map((l) => l.kind).sort()).toEqual(["Private key", "Stripe API key"]);
    expect(JSON.stringify(r)).not.toContain("A1b2C3d4");
  });
});
