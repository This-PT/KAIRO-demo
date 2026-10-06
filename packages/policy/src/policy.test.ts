import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NormalizedTicket } from "@kairo/core";
import { applyPolicy, evaluateVisibility, type Rule } from "./policy";

const load = (k: string): NormalizedTicket =>
  JSON.parse(readFileSync(join(__dirname, "../../../fixtures/jira", `${k}.json`), "utf8"));
const base = (labels: string[] = []): NormalizedTicket => ({ ...load("HND-4"), labels });

describe("evaluateVisibility", () => {
  it("defaults to restricted when no rules exist", () => {
    expect(evaluateVisibility(base(), [])).toBe("restricted");
  });
  it("uses a project-level rule when no label matches", () => {
    const rules: Rule[] = [{ label: null, visibility: "readable" }];
    expect(evaluateVisibility(base(["x"]), rules)).toBe("readable");
  });
  it("a restricted label beats a readable project rule", () => {
    const rules: Rule[] = [
      { label: null, visibility: "readable" },
      { label: "hr-confidential", visibility: "restricted" },
    ];
    expect(evaluateVisibility(base(["hr-confidential"]), rules)).toBe("restricted");
  });
  it("a readable label overrides a restricted project rule", () => {
    const rules: Rule[] = [
      { label: null, visibility: "restricted" },
      { label: "public", visibility: "readable" },
    ];
    expect(evaluateVisibility(base(["public"]), rules)).toBe("readable");
  });
  it("restricted wins when matching labels conflict", () => {
    const rules: Rule[] = [
      { label: "a", visibility: "readable" },
      { label: "b", visibility: "restricted" },
    ];
    expect(evaluateVisibility(base(["a", "b"]), rules)).toBe("restricted");
  });
  it("label matching is case-insensitive", () => {
    const rules: Rule[] = [{ label: null, visibility: "readable" }, { label: "HR-Confidential", visibility: "restricted" }];
    expect(evaluateVisibility(base(["hr-confidential"]), rules)).toBe("restricted");
  });
});

describe("applyPolicy", () => {
  const rules: Rule[] = [
    { label: null, visibility: "readable" },
    { label: "hr-confidential", visibility: "restricted" },
  ];

  it("returns no ticket content for restricted tickets", () => {
    const r = applyPolicy(load("HND-6"), rules);
    expect(r.visibility).toBe("restricted");
    expect("ticket" in r).toBe(false);
  });

  it("redacts every text field of readable tickets", () => {
    const r = applyPolicy(load("HND-2"), rules);
    expect(r.visibility).toBe("readable");
    if (r.visibility !== "readable") return;
    const all = JSON.stringify(r.ticket);
    expect(all).not.toContain("sk_live_");
    expect(all).not.toContain("lee.chen@example.com");
    expect(all).not.toContain("Sup3rS3cret");
    expect(r.redactions.length).toBeGreaterThan(0);
  });

  it("redacts secrets in titles and changelog values too", () => {
    const t = { ...base(), title: "key sk_live_FAKEDEMO0001", changelog: [{ author: "a", created: "x", field: "desc", from: "password=abc", to: "ok" }] };
    const r = applyPolicy(t, rules);
    if (r.visibility !== "readable") throw new Error("expected readable");
    expect(JSON.stringify(r.ticket)).not.toContain("sk_live_");
    expect(JSON.stringify(r.ticket)).not.toContain("password=abc");
  });

  it("does not mutate the input ticket", () => {
    const t = load("HND-2");
    const copy = JSON.stringify(t);
    applyPolicy(t, rules);
    expect(JSON.stringify(t)).toBe(copy);
  });
});
