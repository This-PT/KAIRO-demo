import { randomBytes } from "node:crypto";
import IORedis from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider } from "@handover/ai";
import { FixtureConnector } from "@handover/connectors";
import { prisma, wipeProject } from "@handover/db";
import { createQueues, startWorkers, type Workers } from "./queues";

const redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
const prefix = `test-${randomBytes(4).toString("hex")}`;
let workers: Workers;
let queues: ReturnType<typeof createQueues>;

async function waitFor<T>(fn: () => Promise<T | false>, ms = 15000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for condition");
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  const p = await prisma.project.create({ data: { key: "HND", name: "Handover Demo", connectionId: conn.id, enabled: true } });
  await prisma.policyRule.createMany({
    data: [
      { projectId: p.id, label: null, visibility: "readable" },
      { projectId: p.id, label: "hr-confidential", visibility: "restricted" },
    ],
  });
  queues = createQueues(redis, prefix);
  workers = startWorkers({
    redis,
    prefix,
    db: prisma,
    queues,
    connector: new FixtureConnector(),
    provider: new HeuristicProvider(),
    encryptionKey: randomBytes(32).toString("base64"),
    summarizeConcurrency: 2,
  });
});
afterAll(async () => {
  await workers.close();
  await queues.obliterate();
  await queues.close();
  await redis.quit();
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});

describe("job flow (real Redis + Postgres)", () => {
  it("ingest job -> summarize jobs: 9 readable tickets summarized, the restricted one never", async () => {
    await queues.enqueueIngest("HND");
    await waitFor(async () => (await prisma.summary.count({ where: { ticket: { project: { key: "HND" } } } })) === 9);
    const restricted = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-6" } });
    expect(restricted.visibility).toBe("restricted");
    expect(await prisma.summary.count({ where: { ticketId: restricted.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { ticketId: restricted.id } })).toBe(0);
    const run = await prisma.ingestRun.findFirstOrThrow({ where: { project: { key: "HND" } } });
    expect(run.status).toBe("done");
  });

  it("re-running ingest changes nothing and queues no new summaries", async () => {
    const before = await prisma.auditLog.count();
    await queues.enqueueIngest("HND");
    await waitFor(async () => (await prisma.ingestRun.count({ where: { project: { key: "HND" }, status: "done" } })) === 2);
    await new Promise((r) => setTimeout(r, 500));
    expect(await prisma.auditLog.count()).toBe(before);
  });

  it("deduplicates identical pending summarize jobs", async () => {
    const a = await queues.enqueueSummarize("HND-1");
    const b = await queues.enqueueSummarize("HND-1");
    expect(a).toBe(b);
  });

  it("fails an ingest for a disabled project instead of silently ingesting", async () => {
    await prisma.project.update({ where: { key: "HND" }, data: { enabled: false } });
    const before = await prisma.ingestRun.count();
    await queues.enqueueIngest("HND");
    await new Promise((r) => setTimeout(r, 800));
    expect(await prisma.ingestRun.count()).toBe(before);
    await prisma.project.update({ where: { key: "HND" }, data: { enabled: true } });
  });
});
