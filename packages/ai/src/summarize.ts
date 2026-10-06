import { buildPrompt } from "./prompt";
import { InvalidJsonError, type LlmProvider } from "./provider";
import { summaryJsonSchema, validateSummary, type Summary } from "./schema";
import { resolveOutcome, verifyEvidence, type Outcome } from "./verify";

export interface AuditSink {
  /** Called BEFORE the payload is sent to the provider. Returns an id for finish(). */
  record(e: { provider: string; model: string; payload: string; attempt: number }): Promise<string>;
  finish(id: string, outcome: string): Promise<void>;
}

export interface SummarizeInput {
  provider: LlmProvider;
  ticketKey: string;
  /** Exact text sent to the model; evidence quotes are verified against it. */
  ticketText: string;
  audit?: AuditSink;
}

export interface SummarizeResult {
  status: Outcome["status"];
  summary: Summary | null;
  attempts: number;
  reasons: string[];
}

const MAX_ATTEMPTS = 2; // first try + one retry
const RANK = { ok: 2, downgraded: 1, rejected: 0 } as const;

export async function summarizeTicket(i: SummarizeInput): Promise<SummarizeResult> {
  let best: Outcome | null = null;
  let feedback: string[] = [];
  let attempts = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attempts = attempt;
    const { system, user } = buildPrompt({ ticketKey: i.ticketKey, ticketText: i.ticketText, feedback });
    const auditId = await i.audit?.record({ provider: i.provider.name, model: i.provider.model, payload: `${system}\n\n${user}`, attempt });

    let outcome: Outcome;
    try {
      const { json } = await i.provider.generate({ system, user, schema: summaryJsonSchema, ticketKey: i.ticketKey, ticketText: i.ticketText });
      const v = validateSummary(json, i.ticketKey);
      outcome = v.ok
        ? resolveOutcome(v.summary, verifyEvidence(v.summary, i.ticketText))
        : { status: "rejected", summary: null, reasons: v.errors };
    } catch (e) {
      if (e instanceof InvalidJsonError) {
        outcome = { status: "rejected", summary: null, reasons: ["output was not valid JSON"] };
      } else {
        if (auditId) await i.audit?.finish(auditId, "error");
        throw e;
      }
    }
    if (auditId) await i.audit?.finish(auditId, outcome.status);

    if (!best || RANK[outcome.status] > RANK[best.status]) best = outcome;
    if (outcome.status === "ok") break;
    feedback = outcome.reasons;
  }

  return { status: best!.status, summary: best!.summary, attempts, reasons: best!.reasons };
}
