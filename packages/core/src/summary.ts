import { z } from "zod";

/** Fields that carry claims about the ticket. Each non-empty one needs an evidence quote. */
export const CONTENT_FIELDS = ["problem", "root_cause", "actions", "rationale", "rejected_options", "gotchas"] as const;
export type ContentField = (typeof CONTENT_FIELDS)[number];
const ContentFieldEnum = z.enum(CONTENT_FIELDS);

export const SummarySchema = z
  .object({
    ticket: z.string(),
    problem: z.string(),
    root_cause: z.string(),
    actions: z.array(z.object({ what: z.string(), source: z.string() }).strict()),
    rationale: z.string(),
    rejected_options: z.array(z.object({ option: z.string(), why_rejected: z.string() }).strict()),
    gotchas: z.array(z.string()),
    people: z.array(z.string()),
    related: z.array(z.string()),
    evidence: z.array(z.object({ field: ContentFieldEnum, quote: z.string() }).strict()),
    confidence: z.enum(["high", "medium", "low"]),
    missing: z.array(ContentFieldEnum),
  })
  .strict();
export type Summary = z.infer<typeof SummarySchema>;
