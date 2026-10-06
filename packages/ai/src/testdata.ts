import type { Summary } from "./schema";

/** A valid summary for fixture ticket HND-1 whose quotes are copied verbatim from the rendered ticket text. */
export const hnd1Summary = (): Summary => ({
  ticket: "HND-1",
  problem: "Checkout API returned 504 under more than 200 concurrent users.",
  root_cause: "N+1 queries on the cart items lookup caused by lazy loading in OrderRepository.",
  actions: [{ what: "Batched the lookup into a single IN query.", source: "comment by Dana Kim" }],
  rationale: "",
  rejected_options: [{ option: "Redis cache", why_rejected: "Cache invalidation on price changes is risky." }],
  gotchas: ["The batch query must stay under 1000 ids or Postgres switches to a seq scan."],
  people: ["Dana Kim", "Raj Patel"],
  related: ["HND-4"],
  evidence: [
    { field: "problem", quote: "Checkout API returns 504 when more than 200 concurrent users hit it." },
    { field: "root_cause", quote: "Root cause: lazy loading in OrderRepository." },
    { field: "actions", quote: "Fixed by batching the lookup with a single IN query." },
    { field: "rejected_options", quote: "we rejected it because cache invalidation on price changes is risky" },
    { field: "gotchas", quote: "the batch query must stay under 1000 ids" },
  ],
  confidence: "high",
  missing: ["rationale"],
});
