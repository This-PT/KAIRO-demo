import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { extractKeys } from "./search";
import { MIN_QUOTE_LENGTH, norm } from "./verify";

export const ChatAnswerSchema = z
  .object({
    answer: z.string(),
    citations: z.array(z.object({ ticket: z.string(), quote: z.string() }).strict()),
    confidence: z.enum(["high", "medium", "low"]),
    not_found: z.boolean(),
  })
  .strict();
export type ChatAnswer = z.infer<typeof ChatAnswerSchema>;
export type Citation = ChatAnswer["citations"][number];

/** JSON Schema for the model: strict object, all properties required, no $ref. */
export const chatJsonSchema: Record<string, unknown> = (() => {
  const { $schema: _omit, ...schema } = zodToJsonSchema(ChatAnswerSchema, { $refStrategy: "none" }) as Record<string, unknown>;
  return schema;
})();

export type ChatValidation = { ok: true; answer: ChatAnswer } | { ok: false; errors: string[] };

/** Structural rules: schema, citations required unless not_found, and no tickets outside the provided sources. */
export function validateChatAnswer(raw: unknown, allowedKeys: Set<string>): ChatValidation {
  const parsed = ChatAnswerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  const a = parsed.data;
  const errors: string[] = [];
  if (!a.answer.trim()) errors.push("answer is empty");
  if (a.not_found && a.citations.length > 0) errors.push("a not_found answer must have no citations");
  if (!a.not_found && a.citations.length === 0) errors.push("an answer needs at least one citation (or set not_found to true)");
  for (const c of a.citations) if (!allowedKeys.has(c.ticket)) errors.push(`citation to ${c.ticket}, which was not provided`);

  // Only keys that look like the provided tickets are checked, so "UTF-8" or "SHA-256" are not mistaken for tickets.
  const prefixes = new Set([...allowedKeys].map((k) => k.split("-")[0]));
  for (const k of extractKeys(a.answer)) if (prefixes.has(k.split("-")[0]) && !allowedKeys.has(k)) errors.push(`the answer mentions ${k}, which was not provided`);
  return errors.length ? { ok: false, errors } : { ok: true, answer: a };
}

/** Every quote must appear (after whitespace/case/curly-quote normalization) in the text of the ticket it cites. */
export function verifyCitations(citations: Citation[], sources: Map<string, string>): { good: Citation[]; bad: { citation: Citation; reason: string }[] } {
  const normalized = new Map([...sources].map(([k, v]) => [k, norm(v)]));
  const good: Citation[] = [];
  const bad: { citation: Citation; reason: string }[] = [];
  for (const c of citations) {
    const q = norm(c.quote);
    if (q.length < MIN_QUOTE_LENGTH) bad.push({ citation: c, reason: "empty or too short" });
    else if (!(normalized.get(c.ticket) ?? "").includes(q)) bad.push({ citation: c, reason: `not found in ${c.ticket}` });
    else good.push(c);
  }
  return { good, bad };
}
