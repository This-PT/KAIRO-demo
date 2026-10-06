import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedTicket, renderTicketText } from "@kairo/core";
import { capConfidence, resolveOutcome, verifyEvidence } from "./verify";
import { hnd1Summary } from "./testdata";

const fixture = (k: string) =>
  renderTicketText(NormalizedTicket.parse(JSON.parse(readFileSync(join(__dirname, "../../../fixtures/jira", `${k}.json`), "utf8"))));
const source = fixture("HND-1");

describe("verifyEvidence", () => {
  it("passes when every quote, person and related key appears in the source", () => {
    const r = verifyEvidence(hnd1Summary(), source);
    expect(r.badQuotes).toEqual([]);
    expect(r.unsupportedFields).toEqual([]);
    expect(r.unverifiedNames).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("ignores whitespace and case differences", () => {
    const s = hnd1Summary();
    s.evidence[0] = { field: "problem", quote: "  CHECKOUT api returns 504\n when more   than 200 concurrent users hit it. " };
    expect(verifyEvidence(s, source).ok).toBe(true);
  });

  it("treats typographic quotes and dashes as equal to ASCII", () => {
    const s = hnd1Summary();
    s.evidence.push({ field: "gotchas", quote: "it's a \"known\" issue - see docs." });
    const src = source + "\nNote: it’s a “known” issue – see docs.";
    expect(verifyEvidence(s, src).ok).toBe(true);
  });

  it("fails a paraphrased quote", () => {
    const s = hnd1Summary();
    s.evidence[1] = { field: "root_cause", quote: "The ORM was loading related rows one at a time" };
    const r = verifyEvidence(s, source);
    expect(r.ok).toBe(false);
    expect(r.badQuotes.map((b) => b.index)).toEqual([1]);
    expect(r.unsupportedFields).toEqual(["root_cause"]);
  });

  it("fails an invented quote", () => {
    const s = hnd1Summary();
    s.evidence.push({ field: "rationale", quote: "We chose this because the CTO insisted." });
    expect(verifyEvidence(s, source).badQuotes).toHaveLength(1);
  });

  it("fails empty and too-short quotes", () => {
    const s = hnd1Summary();
    s.evidence.push({ field: "problem", quote: "" }, { field: "problem", quote: "a" });
    const r = verifyEvidence(s, source);
    expect(r.badQuotes.map((b) => b.reason)).toEqual(["empty or too short", "empty or too short"]);
  });

  it("fails people and related keys that are not in the source", () => {
    const s = hnd1Summary();
    s.people.push("Invented Person");
    s.related.push("HND-999");
    const r = verifyEvidence(s, source);
    expect(r.unverifiedNames).toEqual([
      { kind: "people", value: "Invented Person" },
      { kind: "related", value: "HND-999" },
    ]);
    expect(r.ok).toBe(false);
  });

  it("flags a non-empty field whose only evidence is invalid even if other fields are fine", () => {
    const s = hnd1Summary();
    s.evidence = s.evidence.map((e) => (e.field === "gotchas" ? { ...e, quote: "nothing like this exists in the ticket" } : e));
    expect(verifyEvidence(s, source).unsupportedFields).toEqual(["gotchas"]);
  });

  it("is not fooled by quotes taken from a different ticket", () => {
    const other = fixture("HND-3");
    expect(verifyEvidence(hnd1Summary(), other).ok).toBe(false);
  });
});

describe("resolveOutcome", () => {
  it("returns ok unchanged when verification passed", () => {
    const s = hnd1Summary();
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("ok");
    expect(o.summary).toEqual(s);
  });

  it("downgrades confidence and drops bad quotes/names when a minority fail but every field stays supported", () => {
    const s = hnd1Summary();
    s.evidence.push({ field: "problem", quote: "Customers were furious about it." });
    s.evidence.push({ field: "gotchas", quote: "Also this was a Friday deploy." });
    s.evidence.push({ field: "problem", quote: "Fixed by batching the lookup with a single IN query." });
    s.people.push("Ghost Writer");
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("downgraded");
    expect(o.summary!.confidence).toBe("medium");
    expect(o.summary!.evidence.every((e) => verifyEvidence({ ...hnd1Summary(), evidence: [e] }, source).badQuotes.length === 0)).toBe(true);
    expect(o.summary!.people).not.toContain("Ghost Writer");
  });

  it.each([
    ["high", "medium"],
    ["medium", "low"],
    ["low", "low"],
  ] as const)("lowers %s to %s", (from, to) => {
    const s = { ...hnd1Summary(), confidence: from };
    s.people.push("Ghost Writer");
    expect(resolveOutcome(s, verifyEvidence(s, source)).summary!.confidence).toBe(to);
  });

  it("rejects when a non-empty field loses all its support", () => {
    const s = hnd1Summary();
    s.evidence = s.evidence.map((e) => (e.field === "root_cause" ? { ...e, quote: "made up root cause text" } : e));
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("rejected");
    expect(o.summary).toBeNull();
    expect(o.reasons.join()).toMatch(/root_cause/);
  });

  it("rejects when more than 25% of quotes are bad", () => {
    const s = hnd1Summary();
    s.evidence.push({ field: "problem", quote: "bad one number one" }, { field: "problem", quote: "bad one number two" });
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("rejected");
  });
});

describe("capConfidence", () => {
  type Field = "root_cause" | "actions" | "rationale" | "rejected_options" | "gotchas";
  /** hnd1Summary with exactly these content fields emptied and listed as missing (rationale is always missing). */
  const missing = (...fields: Field[]) => {
    const s = hnd1Summary();
    for (const f of fields) {
      if (f === "root_cause") s.root_cause = "";
      else (s[f] as unknown[]) = [];
    }
    const all = ["rationale", ...fields] as typeof s.missing;
    s.missing = [...new Set(all)];
    s.evidence = s.evidence.filter((e) => !fields.includes(e.field as Field));
    return s;
  };

  it("leaves summaries with 0-2 missing fields alone", () => {
    expect(capConfidence(missing()).confidence).toBe("high");
    expect(capConfidence(missing("gotchas")).confidence).toBe("high");
  });
  it("caps at medium with 3 missing fields, never raising a lower value", () => {
    expect(capConfidence({ ...missing("gotchas", "rejected_options"), confidence: "high" }).confidence).toBe("medium");
    expect(capConfidence({ ...missing("gotchas", "rejected_options"), confidence: "medium" }).confidence).toBe("medium");
    expect(capConfidence({ ...missing("gotchas", "rejected_options"), confidence: "low" }).confidence).toBe("low");
  });
  it("forces low with 4 or more missing fields", () => {
    expect(capConfidence({ ...missing("gotchas", "rejected_options", "actions"), confidence: "high" }).confidence).toBe("low");
    expect(capConfidence({ ...missing("gotchas", "rejected_options", "actions", "root_cause"), confidence: "medium" }).confidence).toBe("low");
  });
  it("does not mutate its input", () => {
    const s = { ...missing("gotchas", "rejected_options", "actions"), confidence: "high" as const };
    capConfidence(s);
    expect(s.confidence).toBe("high");
  });
});

describe("resolveOutcome applies the confidence cap", () => {
  const thin = () => {
    const s = hnd1Summary();
    s.gotchas = [];
    s.rejected_options = [];
    s.evidence = s.evidence.filter((e) => e.field !== "gotchas" && e.field !== "rejected_options");
    s.missing = ["rationale", "gotchas", "rejected_options"];
    return s;
  };
  it("lowers a fully verified but thin summary from high to medium", () => {
    const s = thin();
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("ok");
    expect(o.summary!.confidence).toBe("medium");
  });
  it("does not double-penalize a downgraded summary beyond the cap", () => {
    const s = thin();
    s.people.push("Ghost Writer");
    const o = resolveOutcome(s, verifyEvidence(s, source));
    expect(o.status).toBe("downgraded");
    expect(o.summary!.confidence).toBe("medium");
  });
  it("leaves well-supported summaries at their stated confidence", () => {
    const s = hnd1Summary();
    expect(resolveOutcome(s, verifyEvidence(s, source)).summary!.confidence).toBe("high");
  });
});
