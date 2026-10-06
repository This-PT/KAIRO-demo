import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@handover/db";
import { FixtureConnector } from "@handover/connectors";
import { ingestProject } from "@handover/ingest";
import type { Rule } from "@handover/policy";
import { summarizeStoredTicket } from "./job";
import type { LlmProvider } from "./provider";
import { HeuristicProvider } from "./providers/heuristic";
import { hnd1Summary } from "./testdata";

const rules: Rule[] = [
  { label: null, visibility: "readable" },
  { label: "hr-confidential", visibility: "restricted" },
];

async function wipe() {
  const p = await prisma.project.findUnique({ where: { key: "HND" } });
  if (!p) return;
  const t = { ticket: { projectId: p.id } };
  await prisma.auditLog.deleteMany({ where: t });
  await prisma.summary.deleteMany({ where: t });
  await prisma.redactionEvent.deleteMany({ where: t });
  await prisma.ticketLink.deleteMany({ where: { from: { projectId: p.id } } });
  await prisma.ticketContent.deleteMany({ where: t });
  await prisma.ticket.deleteMany({ where: { projectId: p.id } });
  await prisma.ingestRun.deleteMany({ where: { projectId: p.id } });
  await prisma.project.delete({ where: { id: p.id } });
  await prisma.connection.deleteMany({ where: { id: p.connectionId } });
}

beforeAll(async () => {
  await wipe();
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  await prisma.project.create({ data: { key: "HND", name: "Handover Demo", connectionId: conn.id, enabled: true } });
  await ingestProject({
    connector: new FixtureConnector(),
    db: prisma,
    projectKey: "HND",
    rules,
    encryptionKey: randomBytes(32).toString("base64"),
    enqueueSummarize: async () => {},
  });
});
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

const counting = (inner: LlmProvider) => {
  const sent: string[] = [];
  const provider: LlmProvider = {
    name: inner.name,
    model: inner.model,
    async generate(req) {
      sent.push(req.system + "\n" + req.user);
      return inner.generate(req);
    },
  };
  return { provider, sent };
};

describe("summarizeStoredTicket", () => {
  it("summarizes a readable ticket and stores the summary", async () => {
    const { provider } = counting(new HeuristicProvider());
    const r = await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-1" });
    expect(r.status).toBe("ok");
    const rows = await prisma.summary.findMany({ where: { ticket: { key: "HND-1" } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ok", evidenceVerified: true, model: provider.model, promptVersion: "v1" });
    expect((rows[0]!.json as { ticket: string }).ticket).toBe("HND-1");
  });

  it("NEVER calls the LLM for restricted tickets and writes no audit row", async () => {
    const { provider, sent } = counting(new HeuristicProvider());
    const r = await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-6" });
    expect(r.status).toBe("skipped_restricted");
    expect(sent).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { ticket: { key: "HND-6" } } })).toBe(0);
    expect(await prisma.summary.count({ where: { ticket: { key: "HND-6" } } })).toBe(0);
  });

  it("only ever sends redacted text: secrets from HND-2 never reach the provider or the audit log", async () => {
    const { provider, sent } = counting(new HeuristicProvider());
    await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-2" });
    const all = sent.join("\n");
    for (const secret of ["sk_live_", "lee.chen@example.com", "Sup3rS3cret"]) expect(all).not.toContain(secret);
    expect(all).toContain("[REDACTED:");
    const audits = await prisma.auditLog.findMany({ where: { ticket: { key: "HND-2" } } });
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) for (const secret of ["sk_live_", "lee.chen@example.com", "Sup3rS3cret"]) expect(a.payloadSnapshot).not.toContain(secret);
  });

  it("writes the audit row BEFORE the provider is called, with hash, size and the exact payload", async () => {
    let seen: Awaited<ReturnType<typeof prisma.auditLog.findMany>> = [];
    const spy: LlmProvider = {
      name: "spy",
      model: "spy-model",
      async generate(req) {
        seen = await prisma.auditLog.findMany({ where: { ticket: { key: "HND-3" } } });
        return new HeuristicProvider().generate(req);
      },
    };
    await summarizeStoredTicket({ db: prisma, provider: spy, ticketKey: "HND-3" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ provider: "spy", model: "spy-model", outcome: "pending" });
    expect(seen[0]!.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0]!.bytes).toBe(Buffer.byteLength(seen[0]!.payloadSnapshot));
    const final = await prisma.auditLog.findMany({ where: { ticket: { key: "HND-3" } } });
    expect(final[0]!.outcome).toBe("ok");
  });

  it("replaces the previous summary when run again", async () => {
    const { provider } = counting(new HeuristicProvider());
    await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-1" });
    await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-1" });
    expect(await prisma.summary.count({ where: { ticket: { key: "HND-1" } } })).toBe(1);
  });

  it("stores rejected summaries as rejected, without the unverified content", async () => {
    const bad = hnd1Summary();
    bad.evidence = bad.evidence.map((e) => ({ ...e, quote: "totally invented quote text" }));
    const provider: LlmProvider = { name: "bad", model: "bad-model", generate: async () => ({ json: bad }) };
    const r = await summarizeStoredTicket({ db: prisma, provider, ticketKey: "HND-1" });
    expect(r.status).toBe("rejected");
    const row = await prisma.summary.findFirstOrThrow({ where: { ticket: { key: "HND-1" } } });
    expect(row).toMatchObject({ status: "rejected", evidenceVerified: false, attempts: 2 });
    expect(JSON.stringify(row.json)).not.toContain("Redis cache");
  });

  it("does not delete a previous good summary when the provider errors", async () => {
    await summarizeStoredTicket({ db: prisma, provider: new HeuristicProvider(), ticketKey: "HND-1" });
    const down: LlmProvider = { name: "d", model: "d", generate: async () => { throw new Error("network down"); } };
    await expect(summarizeStoredTicket({ db: prisma, provider: down, ticketKey: "HND-1" })).rejects.toThrow("network down");
    expect(await prisma.summary.count({ where: { ticket: { key: "HND-1" }, status: "ok" } })).toBe(1);
  });

  it("throws for unknown tickets", async () => {
    await expect(summarizeStoredTicket({ db: prisma, provider: new HeuristicProvider(), ticketKey: "NOPE-1" })).rejects.toThrow(/not found/i);
  });
});
