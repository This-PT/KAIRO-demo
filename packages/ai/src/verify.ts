import { CONTENT_FIELDS, isFieldEmpty, type ContentField, type Summary } from "./schema";

export const MIN_QUOTE_LENGTH = 5;
const MAX_BAD_QUOTE_RATIO = 0.25;

/** Whitespace, case and typographic quote/dash normalization only. No fuzzy matching. */
export function norm(s: string): string {
  return s
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface VerificationResult {
  badQuotes: { index: number; field: ContentField; quote: string; reason: string }[];
  /** Non-empty fields with no valid evidence quote */
  unsupportedFields: ContentField[];
  /** People / related keys that do not appear in the source text */
  unverifiedNames: { kind: "people" | "related"; value: string }[];
  ok: boolean;
}

/** Checks every evidence quote (and every person / related key) against the exact text the model was given. */
export function verifyEvidence(summary: Summary, sourceText: string): VerificationResult {
  const src = norm(sourceText);
  const badQuotes: VerificationResult["badQuotes"] = [];
  summary.evidence.forEach((e, index) => {
    const q = norm(e.quote);
    if (q.length < MIN_QUOTE_LENGTH) badQuotes.push({ index, field: e.field, quote: e.quote, reason: "empty or too short" });
    else if (!src.includes(q)) badQuotes.push({ index, field: e.field, quote: e.quote, reason: "not found in source" });
  });
  const bad = new Set(badQuotes.map((b) => b.index));
  const unsupportedFields = CONTENT_FIELDS.filter(
    (f) => !isFieldEmpty(summary, f) && !summary.evidence.some((e, i) => e.field === f && !bad.has(i)),
  );
  const unverifiedNames = [
    ...summary.people.filter((p) => !src.includes(norm(p))).map((value) => ({ kind: "people" as const, value })),
    ...summary.related.filter((r) => !src.includes(norm(r))).map((value) => ({ kind: "related" as const, value })),
  ];
  return { badQuotes, unsupportedFields, unverifiedNames, ok: !badQuotes.length && !unsupportedFields.length && !unverifiedNames.length };
}

export type Outcome =
  | { status: "ok"; summary: Summary; reasons: string[] }
  | { status: "downgraded"; summary: Summary; reasons: string[] }
  | { status: "rejected"; summary: null; reasons: string[] };

const LOWER = { high: "medium", medium: "low", low: "low" } as const;

/**
 * Models tend to rate thin tickets (for example one whose only comment is "Fixed.") as high confidence.
 * Confidence cannot exceed what the ticket supports: 3 missing fields cap it at medium, 4 or more force low.
 * This only ever lowers confidence.
 */
export function capConfidence(summary: Summary): Summary {
  const missing = summary.missing.length;
  const confidence = missing >= 4 ? "low" : missing === 3 && summary.confidence === "high" ? "medium" : summary.confidence;
  return confidence === summary.confidence ? summary : { ...summary, confidence };
}

/**
 * ok        -> nothing failed.
 * rejected  -> a non-empty field lost all support, or more than 25% of quotes are bad.
 * downgraded-> a few bad quotes / names: drop them and lower confidence one level.
 * Confidence is also capped by how much the ticket actually supports (see capConfidence).
 */
export function resolveOutcome(summary: Summary, result: VerificationResult): Outcome {
  if (result.ok) return { status: "ok", summary: capConfidence(summary), reasons: [] };

  const reasons = [
    ...result.unsupportedFields.map((f) => `${f} has no valid evidence`),
    ...result.badQuotes.map((b) => `bad quote for ${b.field} (${b.reason}): ${b.quote}`),
    ...result.unverifiedNames.map((n) => `${n.kind} "${n.value}" not found in source`),
  ];
  const ratio = summary.evidence.length ? result.badQuotes.length / summary.evidence.length : 0;
  if (result.unsupportedFields.length > 0 || ratio > MAX_BAD_QUOTE_RATIO) {
    return { status: "rejected", summary: null, reasons };
  }

  const bad = new Set(result.badQuotes.map((b) => b.index));
  const badNames = new Set(result.unverifiedNames.map((n) => `${n.kind}:${n.value}`));
  return {
    status: "downgraded",
    reasons,
    summary: capConfidence({
      ...summary,
      evidence: summary.evidence.filter((_, i) => !bad.has(i)),
      people: summary.people.filter((p) => !badNames.has(`people:${p}`)),
      related: summary.related.filter((r) => !badNames.has(`related:${r}`)),
      confidence: LOWER[summary.confidence],
    }),
  };
}
