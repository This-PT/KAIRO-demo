interface AdfNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

const children = (n: AdfNode) => (n.content ?? []).map(walk).join("");

function walk(n: AdfNode): string {
  switch (n.type) {
    case "text":
      return n.text ?? "";
    case "mention":
      return String(n.attrs?.text ?? "");
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    case "inlineCard":
      return String(n.attrs?.url ?? "");
    case "hardBreak":
      return "\n";
    case "paragraph":
    case "heading":
    case "codeBlock":
    case "blockquote":
      return children(n) + "\n";
    case "listItem":
      return "- " + children(n).trim() + "\n";
    default:
      return children(n);
  }
}

/** Converts Atlassian Document Format (or a plain string) to plain text. */
export function adfToText(doc: unknown): string {
  if (doc == null) return "";
  if (typeof doc === "string") return doc;
  return walk(doc as AdfNode).replace(/\n{3,}/g, "\n\n").trim();
}
