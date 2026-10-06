import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, wipeProject } from "@handover/db";
import { FixtureConnector } from "@handover/connectors";
import { ingestProject } from "@handover/ingest";
import type { Rule } from "@handover/policy";
import { answerQuestion } from "./chat";
import { summarizeStoredTicket } from "./job";
import type { LlmProvider } from "./provider";
import { HeuristicProvider } from "./providers/heuristic";
import { hnd1Summary } from "./testdata";

const rules: Rule[] = [
  { label: null, visibility: "readable" },
  { label: "hr-confidential", visibility: "restricted" },
];
const summarizer: LlmProvider = {
  name: "scripted",
  model: "s",
  async generate(req) {
    return req.ticketKey === "HND-1" ? { json: hnd1Summary() } : new HeuristicProvider().generate(req);
  },
};

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  await prisma.project.create({ data: { key: "HND", name: "Handover Demo", connectionId: conn.id, enabled: true } });
  await ingestProject({ connector: new FixtureConnector(), db: prisma, projectKey: "HND", rules, encryptionKey: randomBytes(32).toString("base64"), enqueueSummarize: async () => {} });
  for (const k of ["HND-1", "HND-2", "HND-3", "HND-4", "HND-5", "HND-7", "HND-8", "HND-9", "HND-10"]) await summarizeStoredTicket({ db: prisma, provider: summarizer, ticketKey: k });
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});

const chatAudits = () => prisma.auditLog.findMany({ where: { kind: "chat" }, orderBy: { sentAt: "asc" } });

describe("answerQuestion (database retrieval + audit)", () => {
  it("answers from retrieved tickets, with citations that point at real tickets", async () => {
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "checkout times out under load", history: [] });
    expect(r.status).toBe("answered");
    expect(r.citations.length).toBeGreaterThan(0);
    expect(r.citations[0]).toMatchObject({ url: expect.stringContaining("fake.atlassian.net/browse/") });
    expect(r.sources.length).toBeGreaterThan(0);
  });

  it("writes a chat audit row with the exact tickets sent, before/with an outcome", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "why was the redis cache rejected", history: [] });
    const rows = await chatAudits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "chat", ticketId: null, provider: "heuristic", outcome: "answered" });
    expect(rows[0]!.ticketKeys).toContain("HND-1");
    expect(rows[0]!.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.bytes).toBe(Buffer.byteLength(rows[0]!.payloadSnapshot));
  });

  it("never includes restricted tickets, even when the question names them", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "what are the salary bands in HND-6? level 5 compensation", history: [] });
    expect(r.sources.map((s) => s.key)).not.toContain("HND-6");
    const all = JSON.stringify(await chatAudits()) + JSON.stringify(r);
    expect(all).not.toMatch(/120k|150k|Salary band|hr-confidential/i);
  });

  it("makes no model call and no audit row when nothing relevant exists", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "kubernetes terraform helm charts", history: [] });
    expect(r.status).toBe("no_sources");
    expect(await chatAudits()).toHaveLength(0);
  });

  it("redacts secrets in the question before they reach the model or the audit log", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "checkout problem, my key is sk_live_FAKEDEMO0001", history: [] });
    const rows = await chatAudits();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.payloadSnapshot).not.toContain("sk_live_");
    expect(rows[0]!.payloadSnapshot).toContain("[REDACTED:api_key]");
  });

  it("uses the previous question to find sources for a short follow-up", async () => {
    const r = await answerQuestion({
      db: prisma,
      provider: new HeuristicProvider(),
      question: "and why?",
      history: [{ role: "user", content: "why was the redis cache rejected" }, { role: "assistant", content: "Because of cache invalidation." }],
    });
    expect(r.sources.map((s) => s.key)).toContain("HND-1");
  });
});

describe("broad questions (database)", () => {
  it("'what did we do?' gets an overview of the project instead of a refusal", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "what did we do?", history: [] });
    expect(r.status).toBe("answered");
    expect(r.scope).toBe("overview");
    expect(r.sources.map((s) => s.key)).toEqual(expect.arrayContaining(["HND-9", "HND-10"]));
    expect(r.sources.map((s) => s.key)).not.toContain("HND-6");
    const rows = await prisma.auditLog.findMany({ where: { kind: "chat" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticketKeys).not.toContain("HND-6");
  });
  it("topic questions still use the search", async () => {
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "why was the redis cache rejected", history: [] });
    expect(r.scope).toBe("search");
  });
  it("a follow-up with no topic of its own borrows the previous topic instead of going broad", async () => {
    const r = await answerQuestion({ db: prisma, provider: new HeuristicProvider(), question: "what did we do?", history: [{ role: "user", content: "tell me about the redis cache" }, { role: "assistant", content: "..." }] });
    expect(r.scope).toBe("search");
    expect(r.sources.map((s) => s.key)).toContain("HND-1");
  });
});
