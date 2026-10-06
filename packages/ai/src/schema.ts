import { CONTENT_FIELDS, SummarySchema, type ContentField, type Summary } from "@kairo/core";
import { zodToJsonSchema } from "zod-to-json-schema";

export { CONTENT_FIELDS, SummarySchema, type ContentField, type Summary } from "@kairo/core";

/** JSON Schema handed to the LLM: strict object, all properties required, no $ref. */
export const summaryJsonSchema: Record<string, unknown> = (() => {
  const { $schema: _omit, ...schema } = zodToJsonSchema(SummarySchema, { $refStrategy: "none" }) as Record<string, unknown>;
  return schema;
})();

export function isFieldEmpty(s: Summary, field: ContentField): boolean {
  const v = s[field];
  return typeof v === "string" ? v.trim().length === 0 : v.length === 0;
}

export type ValidationResult = { ok: true; summary: Summary } | { ok: false; errors: string[] };

/** Schema validation plus the cross-field rules from the brief (missing/empty consistency, evidence coverage). */
export function validateSummary(raw: unknown, ticketKey: string): ValidationResult {
  const parsed = SummarySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const s = parsed.data;
  const errors: string[] = [];
  if (s.ticket !== ticketKey) errors.push(`ticket: expected ${ticketKey} but got ${s.ticket}`);
  for (const f of CONTENT_FIELDS) {
    const empty = isFieldEmpty(s, f);
    const listed = s.missing.includes(f);
    if (empty && !listed) errors.push(`${f} is empty but not listed in missing`);
    if (!empty && listed) errors.push(`${f} is listed in missing but is not empty`);
    if (!empty && !s.evidence.some((e) => e.field === f)) errors.push(`${f} has no evidence quote`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, summary: s };
}
