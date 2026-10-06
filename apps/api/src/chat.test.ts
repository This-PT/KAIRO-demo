import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider, summarizeStoredTicket, type LlmProvider } from "@kairo/ai";
import { FixtureConnector } from "@kairo/connectors";
import { prisma, wipeProject } from "@kairo/db";
import { buildApp } from "./app";
import { processIngest } from "./jobs";

const TOKEN = "test-admin-token-123";
const auth = { authorization: `Bearer ${TOKEN}` };
const noQueues = { enqueueIngest: async () => "x", enqueueSummarize: async () => "x" };

let app: FastifyInstance;
let failing = false;
const provider: LlmProvider = {
  name: "heuristic",
  model: "heuristic-v1",
  async generate(req) {
    if (failing) throw new Error("upstream exploded sk_live_FAKEDEMO0001");
    return new HeuristicProvider().generate(req);
  },
};

const post = (payload: unknown, headers: Record<string, string> = auth) => app.inject({ method: "POST", url: "/api/chat", headers, payload: payload as object });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth });

async function start(limit?: number, readOnly = false) {
  app = await buildApp({
    db: prisma,
    queues: noQueues,
    connector: new FixtureConnector(),
    provider,
    config: { adminToken: TOKEN, webOrigin: "http://localhost:3000", connection: { mode: "demo", baseUrl: "fixtures" }, chatRateLimitPerMinute: limit, readOnly },
  });
}

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  await prisma.chatSession.deleteMany();
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  const p = await prisma.project.create({ data: { key: "HND", name: "Kairo Demo", connectionId: conn.id, enabled: true } });
  await prisma.policyRule.createMany({
    data: [
      { projectId: p.id, label: null, visibility: "readable" },
      { projectId: p.id, label: "hr-confidential", visibility: "restricted" },
    ],
  });
  await processIngest({ db: prisma, connector: new FixtureConnector(), encryptionKey: randomBytes(32).toString("base64"), queues: noQueues }, "HND");
  for (const k of ["HND-1", "HND-2", "HND-3", "HND-4", "HND-5", "HND-7", "HND-8", "HND-9", "HND-10"]) await summarizeStoredTicket({ db: prisma, provider: new HeuristicProvider(), ticketKey: k });
  await start();
});
afterAll(async () => {
  await app.close();
  await prisma.chatSession.deleteMany();
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});

describe("POST /api/chat", () => {
  it("requires auth", async () => expect((await post({ message: "hi there" }, {})).statusCode).toBe(401));

  it("validates the body", async () => {
    expect((await post({})).statusCode).toBe(400);
    expect((await post({ message: "   " })).statusCode).toBe(400);
    expect((await post({ message: "x".repeat(2001) })).statusCode).toBe(400);
    expect((await post({ message: "ok question", sessionId: 5 })).statusCode).toBe(400);
  });

  it("answers from the ticket history with verified citations and starts a session", async () => {
    const r = await post({ message: "Why does checkout time out under load?" });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.message).toMatchObject({ role: "assistant", status: "answered" });
    expect(body.message.citations[0]).toMatchObject({ ticket: "HND-1", url: "https://fake.atlassian.net/browse/HND-1" });
    expect(body.message.sources.map((s: { key: string }) => s.key)).toContain("HND-1");
  });

  it("keeps the conversation: follow-ups join the same session in order", async () => {
    const first = (await post({ message: "Tell me about the nightly report duplicate rows" })).json();
    const second = (await post({ sessionId: first.sessionId, message: "and who worked on it?" })).json();
    expect(second.sessionId).toBe(first.sessionId);
    const s = (await get(`/api/chat/sessions/${first.sessionId}`)).json();
    expect(s.title).toBe("Tell me about the nightly report duplicate rows");
    expect(s.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(s.messages[1].citations.length).toBeGreaterThan(0);
  });

  it("404s for an unknown session", async () => {
    expect((await post({ sessionId: "does-not-exist", message: "anything about checkout" })).statusCode).toBe(404);
    expect((await get("/api/chat/sessions/does-not-exist")).statusCode).toBe(404);
  });

  it("says so, without calling the model, when nothing relevant exists", async () => {
    await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
    const r = (await post({ message: "kubernetes terraform helm charts" })).json();
    expect(r.message).toMatchObject({ status: "no_sources", citations: [] });
    expect(await prisma.auditLog.count({ where: { kind: "chat" } })).toBe(0);
  });

  it("never exposes restricted tickets and redacts secrets typed into the question, in the reply, storage and audit", async () => {
    const r = await post({ message: "what are the salary bands in HND-6? also my key is sk_live_FAKEDEMO0001" });
    const body = r.json();
    expect(JSON.stringify(body)).not.toMatch(/120k|Salary band|sk_live_/i);
    const stored = await prisma.chatMessage.findMany({ where: { sessionId: body.sessionId } });
    expect(JSON.stringify(stored)).not.toContain("sk_live_");
    expect(stored.find((m) => m.role === "user")!.content).toContain("[REDACTED:api_key]");
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { kind: "chat" } }));
    expect(audits).not.toContain("sk_live_");
    expect(audits).not.toMatch(/120k/);
  });

  it("returns a generic 502 on provider failure, leaks nothing, and stores no half-finished turn", async () => {
    failing = true;
    const before = await prisma.chatMessage.count();
    const r = await post({ message: "checkout times out under load" });
    failing = false;
    expect(r.statusCode).toBe(502);
    expect(r.body).not.toMatch(/exploded|sk_live/);
    expect(await prisma.chatMessage.count()).toBe(before);
  });
});

describe("GET /api/chat/sessions", () => {
  it("lists recent sessions, newest first", async () => {
    const list = (await get("/api/chat/sessions")).json() as { id: string; title: string }[];
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]).toMatchObject({ id: expect.any(String), title: expect.any(String) });
    const times = (await prisma.chatSession.findMany({ orderBy: { createdAt: "desc" } })).map((s) => s.id);
    expect(list.map((s) => s.id)).toEqual(times.slice(0, list.length));
  });
});

describe("rate limit", () => {
  it("returns 429 with Retry-After once the per-minute limit is reached", async () => {
    await app.close();
    await start(3);
    for (let i = 0; i < 3; i++) expect((await post({ message: "checkout times out" })).statusCode).toBe(200);
    const r = await post({ message: "checkout times out" });
    expect(r.statusCode).toBe(429);
    expect(r.headers["retry-after"]).toBeTruthy();
  });
});

describe("private conversations per browser", () => {
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  const as = (visitor: string | null, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { ...auth, ...(visitor ? { "x-visitor-id": visitor } : {}) }, payload: payload as object });

  it("a visitor only sees, opens and continues their own conversations", async () => {
    await app.close();
    await start();
    const mine = (await as(A, "POST", "/api/chat", { message: "Why does checkout time out under load?" })).json();
    expect(mine.sessionId).toBeTruthy();

    const listA = (await as(A, "GET", "/api/chat/sessions")).json() as { id: string }[];
    expect(listA.map((s) => s.id)).toContain(mine.sessionId);
    expect(((await as(B, "GET", "/api/chat/sessions")).json() as { id: string }[]).map((s) => s.id)).not.toContain(mine.sessionId);

    expect((await as(A, "GET", `/api/chat/sessions/${mine.sessionId}`)).statusCode).toBe(200);
    expect((await as(B, "GET", `/api/chat/sessions/${mine.sessionId}`)).statusCode).toBe(404);
    expect((await as(B, "POST", "/api/chat", { sessionId: mine.sessionId, message: "checkout times out" })).statusCode).toBe(404);
    expect((await as(A, "POST", "/api/chat", { sessionId: mine.sessionId, message: "and why?" })).statusCode).toBe(200);
  });

  it("records the owner on new sessions", async () => {
    const r = (await as(B, "POST", "/api/chat", { message: "tell me about the nightly report" })).json();
    expect((await prisma.chatSession.findUniqueOrThrow({ where: { id: r.sessionId } })).ownerId).toBe(B);
  });

  it("calls without a visitor id (the admin token used directly) still see everything", async () => {
    const all = (await as(null, "GET", "/api/chat/sessions")).json() as { id: string }[];
    const owners = new Set((await prisma.chatSession.findMany({ where: { id: { in: all.map((s) => s.id) } } })).map((s) => s.ownerId));
    expect(owners.has(A) && owners.has(B)).toBe(true);
  });

  it.each(["short", "A".repeat(32), "g".repeat(32), "a".repeat(33), "../../etc/passwd", " ".repeat(32)])("rejects the malformed visitor id %j with 400", async (bad) => {
    expect((await as(bad, "GET", "/api/chat/sessions")).statusCode).toBe(400);
    expect((await as(bad, "POST", "/api/chat", { message: "checkout times out" })).statusCode).toBe(400);
  });

  it("in read-only mode a visitor sees their own list, and nobody else's", async () => {
    await app.close();
    await start(undefined, true);
    const mine = (await as(A, "POST", "/api/chat", { message: "Why does checkout time out under load?" })).json();
    expect(((await as(A, "GET", "/api/chat/sessions")).json() as { id: string }[]).map((s) => s.id)).toContain(mine.sessionId);
    expect(((await as(B, "GET", "/api/chat/sessions")).json() as { id: string }[]).map((s) => s.id)).not.toContain(mine.sessionId);
    expect((await as(null, "GET", "/api/chat/sessions")).json()).toEqual([]);
  });
});

describe("broad questions", () => {
  it("answers 'what did we do?' with an overview and says so", async () => {
    await app.close();
    await start();
    const r = (await post({ message: "what did we do?" })).json();
    expect(r.message.status).toBe("answered");
    expect(r.message.scope).toBe("overview");
    expect(r.message.sources.length).toBeGreaterThan(0);
    const saved = (await get(`/api/chat/sessions/${r.sessionId}`)).json();
    expect(saved.messages[1].scope).toBe("overview");
  });
});
