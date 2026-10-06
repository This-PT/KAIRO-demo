import type { LlmProvider, LlmRequest } from "../provider";
import { CONTENT_FIELDS, type Summary } from "../schema";

const HEADERS = new Set(["Comments:", "Changelog:", "Links:"]);

/**
 * Offline provider: no network, no key. It extracts only what is trivially verifiable
 * (the first description line, comment authors, linked keys) and marks everything else missing.
 * Useful for demos, local runs and tests; it is not a substitute for a real model.
 */
export class HeuristicProvider implements LlmProvider {
  readonly name = "heuristic";
  readonly model = "heuristic-v1";

  /** Offline chat: quotes the first description line of the top source. Always low confidence. */
  private chat(c: NonNullable<LlmRequest["chat"]>) {
    for (const s of c.sources) {
      const lines = s.text.split("\n");
      const di = lines.indexOf("Description:");
      const quote = (di >= 0 ? lines[di + 1] : lines[0])?.trim() ?? "";
      if (quote.length >= 5 && !HEADERS.has(quote)) {
        return { answer: `The closest ticket is [${s.key}]: ${quote} (offline mode: connect an AI model for real answers).`, citations: [{ ticket: s.key, quote }], confidence: "low", not_found: false };
      }
    }
    return { answer: "I couldn't find anything relevant in the tickets provided.", citations: [], confidence: "low", not_found: true };
  }

  async generate(req: LlmRequest): Promise<{ json: unknown }> {
    if (req.chat) return { json: this.chat(req.chat) };
    const lines = req.ticketText.split("\n");
    const di = lines.indexOf("Description:");
    const first = di >= 0 ? (lines[di + 1] ?? "").trim() : "";
    const problem = first.length >= 5 && !HEADERS.has(first) ? first : "";

    const section = (header: string) => {
      const start = lines.indexOf(header);
      if (start < 0) return [];
      const out: string[] = [];
      for (const l of lines.slice(start + 1)) {
        if (!l.startsWith("- ")) break;
        out.push(l);
      }
      return out;
    };
    const people = [...new Set(section("Comments:").flatMap((l) => (/^- (.+?) \(/.exec(l)?.[1] ? [/^- (.+?) \(/.exec(l)![1]!] : [])))];
    const related = [...new Set(section("Links:").flatMap((l) => (/([A-Z][A-Z0-9]+-\d+)$/.exec(l)?.[1] ? [/([A-Z][A-Z0-9]+-\d+)$/.exec(l)![1]!] : [])))];

    const summary: Summary = {
      ticket: req.ticketKey,
      problem,
      root_cause: "",
      actions: [],
      rationale: "",
      rejected_options: [],
      gotchas: [],
      people,
      related,
      evidence: problem ? [{ field: "problem", quote: problem }] : [],
      confidence: "low",
      missing: CONTENT_FIELDS.filter((f) => f !== "problem" || !problem),
    };
    return { json: summary };
  }
}
