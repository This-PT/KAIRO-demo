import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@kairo/db";
import { redact } from "@kairo/policy";
import { PROMPT_VERSION } from "./prompt";
import { summaryToSearchText } from "./search";
import type { LlmProvider } from "./provider";
import { summarizeTicket, type AuditSink } from "./summarize";

export interface SummarizeStoredOptions {
  db: PrismaClient;
  provider: LlmProvider;
  ticketKey: string;
}

export type SummarizeStoredResult =
  | { status: "skipped_restricted" }
  | { status: "ok" | "downgraded" | "rejected"; attempts: number; reasons: string[] };

/**
 * Background-job body: loads a stored ticket, summarizes it, audits what was sent, saves the result.
 * Only the stored redacted text can reach the provider; restricted tickets never do.
 */
export async function summarizeStoredTicket(o: SummarizeStoredOptions): Promise<SummarizeStoredResult> {
  const ticket = await o.db.ticket.findUnique({ where: { key: o.ticketKey }, include: { content: true } });
  if (!ticket) throw new Error(`Ticket ${o.ticketKey} not found`);
  if (ticket.visibility !== "readable" || !ticket.content?.redactedText) return { status: "skipped_restricted" };

  // Defense in depth: redaction is idempotent, so this only changes text if something slipped through.
  const text = redact(ticket.content.redactedText).text;

  const audit: AuditSink = {
    async record(e) {
      const row = await o.db.auditLog.create({
        data: {
          ticketId: ticket.id,
          provider: e.provider,
          model: e.model,
          payloadHash: createHash("sha256").update(e.payload).digest("hex"),
          payloadSnapshot: e.payload,
          bytes: Buffer.byteLength(e.payload),
          outcome: "pending",
        },
      });
      return row.id;
    },
    async finish(id, outcome) {
      await o.db.auditLog.update({ where: { id }, data: { outcome } });
    },
  };

  const r = await summarizeTicket({ provider: o.provider, ticketKey: o.ticketKey, ticketText: text, audit });
  const rejected = r.status === "rejected";
  const data = {
    ticketId: ticket.id,
    json: (rejected ? { rejected: true, reasons: r.reasons } : r.summary) as unknown as Prisma.InputJsonValue,
    confidence: r.summary?.confidence ?? "low",
    model: o.provider.model,
    promptVersion: PROMPT_VERSION,
    evidenceVerified: !rejected,
    status: rejected ? ("rejected" as const) : ("ok" as const),
    attempts: r.attempts,
    // Only verified summaries are searchable (and therefore usable by chat).
    searchText: r.summary ? summaryToSearchText({ key: ticket.key, title: ticket.title, labels: ticket.labels }, r.summary) : "",
  };
  await o.db.$transaction([o.db.summary.deleteMany({ where: { ticketId: ticket.id } }), o.db.summary.create({ data })]);
  return { status: r.status, attempts: r.attempts, reasons: r.reasons };
}
