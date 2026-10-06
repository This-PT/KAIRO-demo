import { ProviderRefusalError, type LlmProvider } from "@handover/ai";
import type { Connector } from "@handover/connectors";
import type { PrismaClient } from "@handover/db";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import type IORedis from "ioredis";
import type { JobQueues } from "./app";
import { processIngest, processSummarize } from "./jobs";

export type Queues = JobQueues & { close(): Promise<void>; obliterate(): Promise<void> };

export function createQueues(redis: IORedis, prefix = "handover"): Queues {
  const ingest = new Queue("ingest", { connection: redis, prefix });
  const summarize = new Queue("summarize", { connection: redis, prefix });
  return {
    async enqueueIngest(projectKey) {
      // Unique id: a run triggered while another finishes must not be swallowed. The worker runs ingests one at a time.
      const job = await ingest.add("ingest", { projectKey }, { jobId: `ingest-${projectKey}-${Date.now()}`, removeOnComplete: true, removeOnFail: 100 });
      return job.id!;
    },
    async enqueueSummarize(ticketKey) {
      // Same id while pending collapses duplicate requests for one ticket.
      const job = await summarize.add("summarize", { ticketKey }, {
        jobId: `summarize-${ticketKey}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100,
      });
      return job.id!;
    },
    async close() {
      await ingest.close();
      await summarize.close();
    },
    async obliterate() {
      await ingest.obliterate({ force: true });
      await summarize.obliterate({ force: true });
    },
  };
}

export interface WorkerOptions {
  redis: IORedis;
  prefix?: string;
  db: PrismaClient;
  queues: JobQueues;
  connector: Connector;
  provider: LlmProvider;
  encryptionKey: string;
  summarizeConcurrency: number;
}
export interface Workers {
  close(): Promise<void>;
}

export function startWorkers(o: WorkerOptions): Workers {
  const common = { connection: o.redis, prefix: o.prefix ?? "handover" };

  const ingest = new Worker(
    "ingest",
    (job) => processIngest({ db: o.db, connector: o.connector, encryptionKey: o.encryptionKey, queues: o.queues }, job.data.projectKey as string),
    { ...common, concurrency: 1 },
  );

  const summarize = new Worker(
    "summarize",
    async (job) => {
      try {
        return await processSummarize({ db: o.db, provider: o.provider }, job.data.ticketKey as string);
      } catch (e) {
        // A refusal will not change on retry.
        if (e instanceof ProviderRefusalError) throw new UnrecoverableError(e.message);
        throw e;
      }
    },
    { ...common, concurrency: o.summarizeConcurrency },
  );

  // Log only ids and messages, never job payloads or ticket content.
  for (const w of [ingest, summarize]) w.on("failed", (job, err) => console.error(`[${w.name}] job ${job?.id} failed: ${err.message}`));

  return {
    async close() {
      await ingest.close();
      await summarize.close();
    },
  };
}

/** For deployments without Redis (read-only demo). Nothing can be queued; the API blocks the routes that would try. */
export function createDisabledQueues(): Queues {
  const off = async (): Promise<string> => {
    throw new Error("Background jobs are disabled in this deployment (no Redis is configured).");
  };
  return { enqueueIngest: off, enqueueSummarize: off, close: async () => {}, obliterate: async () => {} };
}
