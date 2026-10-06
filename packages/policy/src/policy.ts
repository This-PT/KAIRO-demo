import type { NormalizedTicket, Visibility } from "@kairo/core";
import { redact, type RedactionEvent } from "./redact";

export interface Rule {
  /** null = project-level rule */
  label: string | null;
  visibility: Visibility;
}

declare const brand: unique symbol;
/** A ticket that passed the policy filter and was redacted. The only ticket shape the AI layer accepts. */
export type RedactedReadableTicket = NormalizedTicket & { readonly [brand]: true };

export type PolicyResult =
  | { visibility: "restricted" }
  | { visibility: "readable"; ticket: RedactedReadableTicket; redactions: RedactionEvent[] };

/**
 * Precedence (fail-safe):
 * 1. Matching label rules: any restricted -> restricted, else any readable -> readable.
 * 2. Project-level rules: any restricted -> restricted, else readable.
 * 3. No matching rule -> restricted.
 */
export function evaluateVisibility(ticket: NormalizedTicket, rules: Rule[]): Visibility {
  const labels = new Set(ticket.labels.map((l) => l.toLowerCase()));
  const decide = (rs: Rule[]): Visibility | null =>
    rs.length === 0 ? null : rs.some((r) => r.visibility === "restricted") ? "restricted" : "readable";
  const labelRules = rules.filter((r) => r.label !== null && labels.has(r.label.toLowerCase()));
  return decide(labelRules) ?? decide(rules.filter((r) => r.label === null)) ?? "restricted";
}

export function applyPolicy(ticket: NormalizedTicket, rules: Rule[]): PolicyResult {
  if (evaluateVisibility(ticket, rules) === "restricted") return { visibility: "restricted" };

  const totals = new Map<string, number>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      const r = redact(v);
      for (const e of r.events) totals.set(e.type, (totals.get(e.type) ?? 0) + e.count);
      return r.text;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const clean = walk(ticket) as RedactedReadableTicket;
  const redactions = [...totals].map(([type, count]) => ({ type: type as RedactionEvent["type"], count }));
  return { visibility: "readable", ticket: clean, redactions };
}
