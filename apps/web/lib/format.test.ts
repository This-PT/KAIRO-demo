import { describe, expect, it } from "vitest";
import { confidenceTone, groupEvidence, parseSummary, safeHref } from "./format";

describe("safeHref", () => {
  it("allows http and https only", () => {
    expect(safeHref("https://x.atlassian.net/browse/A-1")).toBe("https://x.atlassian.net/browse/A-1");
    expect(safeHref("http://localhost/a")).toBe("http://localhost/a");
  });
  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "//evil.com", "/relative", "", "not a url"])(
    "rejects %s",
    (u) => expect(safeHref(u)).toBeNull(),
  );
  it("handles null and undefined", () => {
    expect(safeHref(null)).toBeNull();
    expect(safeHref(undefined)).toBeNull();
  });
});

describe("confidenceTone", () => {
  it("maps confidence to a tone", () => {
    expect(confidenceTone("high")).toBe("good");
    expect(confidenceTone("medium")).toBe("warn");
    expect(confidenceTone("low")).toBe("bad");
    expect(confidenceTone("whatever")).toBe("bad");
  });
});

describe("groupEvidence", () => {
  it("groups quotes by field preserving order", () => {
    expect(
      groupEvidence([
        { field: "problem", quote: "a" },
        { field: "gotchas", quote: "b" },
        { field: "problem", quote: "c" },
      ]),
    ).toEqual({ problem: ["a", "c"], gotchas: ["b"] });
  });
  it("returns an empty object for no evidence", () => expect(groupEvidence([])).toEqual({}));
});

describe("parseSummary", () => {
  const valid = {
    ticket: "A-1", problem: "p", root_cause: "", actions: [], rationale: "", rejected_options: [], gotchas: [],
    people: [], related: [], evidence: [{ field: "problem", quote: "pppp" }], confidence: "low", missing: ["root_cause", "actions", "rationale", "rejected_options", "gotchas"],
  };
  it("returns a typed summary for valid JSON", () => expect(parseSummary(valid)?.ticket).toBe("A-1"));
  it("returns null for rejected-summary placeholders and garbage", () => {
    expect(parseSummary({ rejected: true, reasons: ["x"] })).toBeNull();
    expect(parseSummary(null)).toBeNull();
    expect(parseSummary("text")).toBeNull();
  });
});
