import { CONTENT_FIELDS, SummarySchema, type ContentField, type Summary } from "@handover/core";

export const FIELD_LABELS: Record<ContentField, string> = {
  problem: "Problem",
  root_cause: "Root cause",
  actions: "What was done",
  rationale: "Rationale",
  rejected_options: "Rejected options",
  gotchas: "Gotchas",
};
export { CONTENT_FIELDS };

/** Only http(s) URLs may become links. Blocks javascript:, data:, relative and protocol-relative URLs. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export type Tone = "good" | "warn" | "bad";
export function confidenceTone(c: string): Tone {
  return c === "high" ? "good" : c === "medium" ? "warn" : "bad";
}

export function groupEvidence(evidence: { field: string; quote: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of evidence) (out[e.field] ??= []).push(e.quote);
  return out;
}

/** Stored summaries are re-validated before rendering. Rejected placeholders and malformed data return null. */
export function parseSummary(json: unknown): Summary | null {
  const r = SummarySchema.safeParse(json);
  return r.success ? r.data : null;
}
