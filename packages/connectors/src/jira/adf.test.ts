import { describe, expect, it } from "vitest";
import { adfToText } from "./adf";

describe("adfToText", () => {
  it("returns plain strings unchanged and null as empty", () => {
    expect(adfToText("hello")).toBe("hello");
    expect(adfToText(null)).toBe("");
    expect(adfToText(undefined)).toBe("");
  });
  it("flattens paragraphs, lists, code blocks and mentions", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First " }, { type: "text", text: "line" }] },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "item b" }] }] },
          ],
        },
        { type: "codeBlock", content: [{ type: "text", text: "const x = 1;" }] },
        { type: "paragraph", content: [{ type: "mention", attrs: { text: "@Dana" } }, { type: "hardBreak" }, { type: "text", text: "thanks" }] },
      ],
    };
    const t = adfToText(doc);
    expect(t).toContain("First line");
    expect(t).toContain("- item a");
    expect(t).toContain("- item b");
    expect(t).toContain("const x = 1;");
    expect(t).toContain("@Dana");
    expect(t).toContain("thanks");
  });
});
