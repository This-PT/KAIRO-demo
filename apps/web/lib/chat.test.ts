import { describe, expect, it } from "vitest";
import { SUGGESTIONS, splitAnswer, suggestionsFor } from "./chat";

describe("splitAnswer", () => {
  it("turns [KEY] markers for known tickets into key parts", () => {
    expect(splitAnswer("It was rejected [HND-1] because of X [HND-3].", new Set(["HND-1", "HND-3"]))).toEqual([
      { type: "text", value: "It was rejected " },
      { type: "key", value: "HND-1" },
      { type: "text", value: " because of X " },
      { type: "key", value: "HND-3" },
      { type: "text", value: "." },
    ]);
  });
  it("leaves markers for unknown tickets as plain text", () => {
    expect(splitAnswer("See [HND-99].", new Set(["HND-1"]))).toEqual([{ type: "text", value: "See [HND-99]." }]);
  });
  it("handles text without markers and empty text", () => {
    expect(splitAnswer("plain", new Set(["HND-1"]))).toEqual([{ type: "text", value: "plain" }]);
    expect(splitAnswer("", new Set())).toEqual([]);
  });
  it("never produces a key part for look-alike markup", () => {
    const parts = splitAnswer('[HND-1](javascript:alert(1)) and <a href="x">[HND-1]</a>', new Set(["HND-1"]));
    expect(parts.filter((p) => p.type === "key")).toHaveLength(2);
    expect(parts.every((p) => p.type === "key" || typeof p.value === "string")).toBe(true);
  });
});

describe("suggestionsFor", () => {
  it("offers questions that fit the loaded project", () => {
    expect(suggestionsFor(["SHOP"]).join(" ")).toMatch(/Elasticsearch|duplicate|charged|login/i);
    expect(suggestionsFor(["HND"])).toEqual(SUGGESTIONS);
  });
  it("falls back to the default set", () => {
    expect(suggestionsFor([])).toEqual(SUGGESTIONS);
    expect(suggestionsFor(["OTHER"])).toEqual(SUGGESTIONS);
  });
  it("gives a handful of short questions", () => {
    for (const keys of [["SHOP"], ["HND"]]) {
      const s = suggestionsFor(keys);
      expect(s.length).toBeGreaterThanOrEqual(3);
      expect(s.length).toBeLessThanOrEqual(6);
      expect(s.every((q) => q.endsWith("?") && q.length < 100)).toBe(true);
    }
  });
});
