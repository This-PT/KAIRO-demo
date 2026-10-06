import { summarizeStoredTicket, type LlmProvider } from "@kairo/ai";
import type { Connector } from "@kairo/connectors";
import type { PrismaClient } from "@kairo/db";
import { ingestProject } from "@kairo/ingest";

export interface IngestDeps {
  db: PrismaClient;
  connector: Connector;
  encryptionKey: string;
  queues: { enqueueSummarize(ticketKey: string): Promise<string> };
}

/** Body of the ingest job. Refuses disabled projects. */
export async function processIngest(d: IngestDeps, projectKey: string) {
  const project = await d.db.project.findUnique({ where: { key: projectKey }, include: { rules: true } });
  if (!project) throw new Error(`Project ${projectKey} not found`);
  if (!project.enabled) throw new Error(`Project ${projectKey} is not enabled`);
  return ingestProject({
    connector: d.connector,
    db: d.db,
    projectKey,
    rules: project.rules.map((r) => ({ label: r.label, visibility: r.visibility })),
    encryptionKey: d.encryptionKey,
    enqueueSummarize: async (key) => void (await d.queues.enqueueSummarize(key)),
  });
}

/** Body of the summarize job. */
export function processSummarize(d: { db: PrismaClient; provider: LlmProvider }, ticketKey: string) {
  return summarizeStoredTicket({ db: d.db, provider: d.provider, ticketKey });
}
