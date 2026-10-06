import { SummarySchema, summaryToSearchText, verifyEvidence } from "@handover/ai";
import type { Prisma, PrismaClient } from "@handover/db";
import { ingestProject, type IngestResult } from "@handover/ingest";
import { DATASETS } from "./demo";

/** Summaries written by an AI model earlier, stored in the repository so a deployment needs no AI calls. */
export interface SummaryExport {
  version: 1;
  project: string;
  summaries: { key: string; json: unknown; confidence: string; model: string; promptVersion: string; attempts: number }[];
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Exports the verified summaries of a project's readable tickets. Restricted tickets never have any. */
export async function exportSummaries(db: PrismaClient, projectKey: string): Promise<SummaryExport> {
  const rows = await db.summary.findMany({
    where: { status: "ok", ticket: { project: { key: projectKey }, visibility: "readable" } },
    include: { ticket: { select: { key: true } } },
  });
  return {
    version: 1,
    project: projectKey,
    summaries: rows
      .map((r) => ({ key: r.ticket.key, json: r.json, confidence: r.confidence, model: r.model, promptVersion: r.promptVersion, attempts: r.attempts }))
      .sort((a, b) => natural(a.key, b.key)),
  };
}

export interface SeedResult {
  ingest: IngestResult;
  seeded: number;
  /** Stored summaries that were malformed or whose quotes are not in the ticket (stale or tampered): not loaded */
  invalid: string[];
  /** Readable tickets with no stored summary: left unsummarized, never invented */
  missing: string[];
}

/**
 * Loads the Shopfront showcase without calling any AI: tickets go through the normal ingest (policy, redaction,
 * encryption of restricted tickets), then the stored summaries are attached after re-verifying every quote.
 */
export async function seedShowcase(o: { db: PrismaClient; encryptionKey: string; summaries: SummaryExport; log?: (line: string) => void }): Promise<SeedResult> {
  const log = o.log ?? (() => {});
  const ds = DATASETS.showcase;
  const conn = (await o.db.connection.findFirst({ where: { baseUrl: "fixtures" } })) ?? (await o.db.connection.create({ data: { type: "fixtures", baseUrl: "fixtures", status: "connected" } }));
  const project = await o.db.project.upsert({
    where: { key: ds.key },
    create: { key: ds.key, name: ds.name, connectionId: conn.id, enabled: true },
    update: { enabled: true },
  });
  const rules = [{ label: null, visibility: "readable" as const }, ...ds.restrictedLabels.map((label) => ({ label, visibility: "restricted" as const }))];
  await o.db.$transaction([
    o.db.policyRule.deleteMany({ where: { projectId: project.id } }),
    o.db.policyRule.createMany({ data: rules.map((r, i) => ({ projectId: project.id, label: r.label, visibility: r.visibility, priority: i })) }),
  ]);

  const ingest = await ingestProject({ connector: ds.connector(), db: o.db, projectKey: ds.key, rules, encryptionKey: o.encryptionKey, enqueueSummarize: async () => {} });
  log(`Ingested ${ingest.fetched} tickets: ${ingest.readable} readable, ${ingest.restricted} restricted, ${ingest.skipped} unchanged.`);

  const stored = new Map(o.summaries.summaries.map((s) => [s.key, s]));
  const todo = await o.db.ticket.findMany({
    where: { projectId: project.id, visibility: "readable", summaries: { none: { status: "ok" } } },
    include: { content: { select: { redactedText: true } } },
  });

  const result: SeedResult = { ingest, seeded: 0, invalid: [], missing: [] };
  for (const t of todo.sort((a, b) => natural(a.key, b.key))) {
    const entry = stored.get(t.key);
    if (!entry) {
      result.missing.push(t.key);
      continue;
    }
    const parsed = SummarySchema.safeParse(entry.json);
    // The quotes must still be in the text the model would have seen, or the stored summary is stale.
    if (!parsed.success || parsed.data.ticket !== t.key || !t.content?.redactedText || !verifyEvidence(parsed.data, t.content.redactedText).ok) {
      result.invalid.push(t.key);
      continue;
    }
    await o.db.summary.create({
      data: {
        ticketId: t.id,
        json: parsed.data as unknown as Prisma.InputJsonValue,
        confidence: parsed.data.confidence,
        model: entry.model,
        promptVersion: entry.promptVersion,
        evidenceVerified: true,
        status: "ok",
        attempts: entry.attempts,
        searchText: summaryToSearchText({ key: t.key, title: t.title, labels: t.labels }, parsed.data),
      },
    });
    result.seeded++;
  }
  log(`Summaries loaded: ${result.seeded}; invalid: ${result.invalid.length}; missing: ${result.missing.length}.`);
  return result;
}

/** Seeds only an empty database, so a restart or redeploy never touches existing data. */
export async function seedIfEmpty(o: { db: PrismaClient; encryptionKey: string; summaries: SummaryExport; log?: (line: string) => void }): Promise<SeedResult | null> {
  if ((await o.db.ticket.count()) > 0) return null;
  return seedShowcase(o);
}
