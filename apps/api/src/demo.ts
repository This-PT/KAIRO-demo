import { summarizeStoredTicket, type LlmProvider } from "@handover/ai";
import { FixtureConnector, type Connector } from "@handover/connectors";
import { wipeProject, type PrismaClient } from "@handover/db";
import { ingestProject, type IngestResult } from "@handover/ingest";

export type DemoDataset = "basic" | "showcase";

export interface DemoOptions {
  db: PrismaClient;
  provider: LlmProvider;
  encryptionKey: string;
  /** "basic" = the 10 small test fixtures (default), "showcase" = the 25-ticket Shopfront team */
  dataset?: DemoDataset;
  /** Delete the demo projects first and rebuild from scratch */
  reset?: boolean;
  log?: (line: string) => void;
}

export interface DemoResult {
  ingest: IngestResult;
  summaries: { ok: number; downgraded: number; rejected: number };
  tickets: { key: string; visibility: string; summary: string | null }[];
}

export const DATASETS: Record<DemoDataset, { key: string; name: string; connector: () => Connector; restrictedLabels: string[] }> = {
  basic: { key: "HND", name: "Handover Demo", connector: () => new FixtureConnector(), restrictedLabels: ["hr-confidential"] },
  showcase: { key: "SHOP", name: "Shopfront", connector: () => FixtureConnector.showcase(), restrictedLabels: ["hr-confidential"] },
};

/** Runs the whole pipeline on fixture tickets in-process: no servers, queues or Jira credentials. */
export async function runDemo(o: DemoOptions): Promise<DemoResult> {
  const log = o.log ?? (() => {});
  const ds = DATASETS[o.dataset ?? "basic"];
  if (o.reset) for (const d of Object.values(DATASETS)) await wipeProject(o.db, d.key);

  const conn = (await o.db.connection.findFirst({ where: { baseUrl: "fixtures" } })) ?? (await o.db.connection.create({ data: { type: "fixtures", baseUrl: "fixtures", status: "connected" } }));
  const project = await o.db.project.upsert({
    where: { key: ds.key },
    create: { key: ds.key, name: ds.name, connectionId: conn.id, enabled: true },
    update: { enabled: true },
  });
  const rules = [
    { label: null, visibility: "readable" as const },
    ...ds.restrictedLabels.map((label) => ({ label, visibility: "restricted" as const })),
  ];
  await o.db.$transaction([
    o.db.policyRule.deleteMany({ where: { projectId: project.id } }),
    o.db.policyRule.createMany({ data: rules.map((r, i) => ({ projectId: project.id, label: r.label, visibility: r.visibility, priority: i })) }),
  ]);
  log(`Policy: readable by default, label${ds.restrictedLabels.length > 1 ? "s" : ""} ${ds.restrictedLabels.map((l) => `'${l}'`).join(", ")} restricted.`);

  const queued = new Set<string>();
  const ingest = await ingestProject({
    connector: ds.connector(),
    db: o.db,
    projectKey: ds.key,
    rules,
    encryptionKey: o.encryptionKey,
    enqueueSummarize: async (k) => void queued.add(k),
  });
  log(`Ingested ${ingest.fetched} tickets: ${ingest.readable} readable, ${ingest.restricted} restricted, ${ingest.skipped} unchanged.`);

  // New or changed tickets, plus any readable ticket that never got a good summary.
  const unsummarized = await o.db.ticket.findMany({ where: { projectId: project.id, visibility: "readable", summaries: { none: { status: "ok" } } }, select: { key: true } });
  for (const t of unsummarized) queued.add(t.key);

  const summaries = { ok: 0, downgraded: 0, rejected: 0 };
  for (const key of [...queued].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const r = await summarizeStoredTicket({ db: o.db, provider: o.provider, ticketKey: key });
    if (r.status === "skipped_restricted") continue;
    summaries[r.status]++;
    log(`  ${key}: ${r.status}${r.status === "ok" ? "" : ` (${r.reasons[0] ?? ""})`}`);
  }

  const rows = await o.db.ticket.findMany({ where: { projectId: project.id }, orderBy: { key: "asc" }, include: { summaries: { orderBy: { createdAt: "desc" }, take: 1 } } });
  return {
    ingest,
    summaries,
    tickets: rows.map((t) => ({ key: t.key, visibility: t.visibility, summary: t.summaries[0]?.status ?? null })),
  };
}
