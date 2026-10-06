import { describe, expect, it } from "vitest";
import { describeEffect, normalizeRules } from "./rules";

describe("normalizeRules", () => {
  it("trims labels and turns blank labels into the project-wide rule (null)", () => {
    const r = normalizeRules([
      { label: "   ", visibility: "readable" },
      { label: " hr-confidential ", visibility: "restricted" },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.rules).toEqual([
      { label: null, visibility: "readable" },
      { label: "hr-confidential", visibility: "restricted" },
    ]);
  });
  it("rejects more than one project-wide rule", () => {
    const r = normalizeRules([
      { label: "", visibility: "readable" },
      { label: "", visibility: "restricted" },
    ]);
    expect(r.errors.join()).toMatch(/project-wide/i);
  });
  it("rejects duplicate labels case-insensitively", () => {
    const r = normalizeRules([
      { label: "Secret", visibility: "restricted" },
      { label: "secret", visibility: "readable" },
    ]);
    expect(r.errors.join()).toMatch(/duplicate/i);
  });
  it("accepts an empty list", () => expect(normalizeRules([])).toEqual({ rules: [], errors: [] }));
});

describe("describeEffect", () => {
  it("explains that nothing is sent when there are no rules", () => {
    expect(describeEffect([]).join(" ")).toMatch(/restricted/i);
  });
  it("describes the project default and label overrides", () => {
    const lines = describeEffect([
      { label: null, visibility: "readable" },
      { label: "hr-confidential", visibility: "restricted" },
    ]).join(" ");
    expect(lines).toMatch(/readable/i);
    expect(lines).toContain("hr-confidential");
  });
  it("warns when labels are readable but no project default exists", () => {
    expect(describeEffect([{ label: "public", visibility: "readable" }]).join(" ")).toMatch(/other tickets.*restricted/i);
  });
});
