import { describe, expect, it } from "vitest";
import { summaryJsonSchema, validateSummary } from "./schema";
import { hnd1Summary } from "./testdata";

const errorsFor = (raw: unknown) => {
  const r = validateSummary(raw, "HND-1");
  return r.ok ? [] : r.errors;
};

describe("validateSummary", () => {
  it("accepts a valid summary", () => {
    const r = validateSummary(hnd1Summary(), "HND-1");
    expect(r.ok).toBe(true);
  });

  it.each(["problem", "root_cause", "actions", "gotchas", "evidence", "confidence", "missing", "people", "related", "rejected_options", "rationale", "ticket"])(
    "rejects a summary without %s",
    (field) => {
      const s: Record<string, unknown> = { ...hnd1Summary() };
      delete s[field];
      expect(errorsFor(s).length).toBeGreaterThan(0);
    },
  );

  it("rejects unknown properties", () => {
    expect(errorsFor({ ...hnd1Summary(), extra: "x" }).length).toBeGreaterThan(0);
  });
  it("rejects an invalid confidence value", () => {
    expect(errorsFor({ ...hnd1Summary(), confidence: "certain" }).length).toBeGreaterThan(0);
  });
  it("rejects wrong types", () => {
    expect(errorsFor({ ...hnd1Summary(), gotchas: "not an array" }).length).toBeGreaterThan(0);
    expect(errorsFor({ ...hnd1Summary(), actions: [{ what: 1, source: "x" }] }).length).toBeGreaterThan(0);
  });
  it("rejects non-objects", () => {
    expect(errorsFor(null).length).toBeGreaterThan(0);
    expect(errorsFor("text").length).toBeGreaterThan(0);
  });
  it("rejects a summary for a different ticket", () => {
    expect(errorsFor({ ...hnd1Summary(), ticket: "HND-2" }).join()).toMatch(/ticket/);
  });

  describe("missing/empty consistency", () => {
    it("requires empty fields to be listed in missing", () => {
      expect(errorsFor({ ...hnd1Summary(), missing: [] }).join()).toMatch(/rationale/);
    });
    it("rejects non-empty fields that are also listed in missing", () => {
      expect(errorsFor({ ...hnd1Summary(), missing: ["rationale", "problem"] }).join()).toMatch(/problem/);
    });
    it("treats empty arrays and blank strings as empty", () => {
      const s = { ...hnd1Summary(), gotchas: [], missing: ["rationale"] };
      expect(errorsFor(s).join()).toMatch(/gotchas/);
      const blank = { ...hnd1Summary(), rationale: "   " };
      expect(validateSummary(blank, "HND-1").ok).toBe(true);
    });
  });

  describe("evidence coverage", () => {
    it("requires evidence for every non-empty content field", () => {
      const s = hnd1Summary();
      s.evidence = s.evidence.filter((e) => e.field !== "root_cause");
      expect(errorsFor(s).join()).toMatch(/root_cause/);
    });
    it("does not require evidence for empty fields", () => {
      expect(validateSummary(hnd1Summary(), "HND-1").ok).toBe(true);
    });
    it("rejects evidence for unknown fields", () => {
      const s = hnd1Summary();
      s.evidence.push({ field: "mood" as never, quote: "whatever" });
      expect(errorsFor(s).length).toBeGreaterThan(0);
    });
  });
});

describe("summaryJsonSchema", () => {
  const schema = summaryJsonSchema as Record<string, any>;
  it("is a strict object schema with every property required", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["actions", "confidence", "evidence", "gotchas", "missing", "people", "problem", "rationale", "rejected_options", "related", "root_cause", "ticket"].sort(),
    );
  });
  it("constrains confidence and uses no $ref (LLM structured output friendly)", () => {
    expect(schema.properties.confidence.enum).toEqual(["high", "medium", "low"]);
    expect(JSON.stringify(schema)).not.toContain("$ref");
  });
});
