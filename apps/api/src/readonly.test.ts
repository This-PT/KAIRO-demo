import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider, summarizeStoredTicket } from "@kairo/ai";
import { FixtureConnector } from "@kairo/connectors";
import { prisma, wipeProject } from "@kairo/db";
import { buildApp } from "./app";
import { processIngest } from "./jobs";

const TOKEN = "test-admin-token-123";
const auth = { authorization: `Bearer ${TOKEN}` };
const queued: string[] = [];
const queues = { enqueueIngest: async (k: string) => (queued.push(k), "x"), enqueueSummarize: async (k: string) => (queued.push(k), "x") };

let app: FastifyInstance;
const send = (method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown) => app.inject({ method, url, headers: auth, payload: payload as object });

async function start(config: Record<string, unknown>) {
  if (app) await app.close();
  app = await buildApp({
    db: prisma,
    queues,
    connector: new FixtureConnector(),
    provider: new HeuristicProvider(),
    config: { adminToken: TOKEN, webOrigin: "http://localhost:3000", connection: { mode: "demo", baseUrl: "fixtures" }, ...config },
  });
}

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  await prisma.chatSession.deleteMany();
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  const p = await prisma.project.create({ data: { key: "HND", name: "Kairo Demo", connectionId: conn.id, enabled: true } });
  await prisma.policyRule.create({ data: { projectId: p.id, label: null, visibility: "readable" } });
  await processIngest({ db: prisma, connector: new FixtureConnector(), encryptionKey: randomBytes(32).toString("base64"), queues }, "HND");
  for (const k of ["HND-1", "HND-2", "HND-3"]) await summarizeStoredTicket({ db: prisma, provider: new HeuristicProvider(), ticketKey: k });
  queued.length = 0;
});
afterAll(async () => {
  await app.close();
  await prisma.chatSession.deleteMany();
  await prisma.auditLog.deleteMany({ where: { kind: "chat" } });
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});

describe("read-only demo mode", () => {
  beforeAll(() => start({ readOnly: true }));

  it("reports itself so the UI can adapt", async () => {
    expect((await send("GET", "/api/connection")).json()).toMatchObject({ mode: "demo", readOnly: true });
  });

  it("still serves everything visitors need to read", async () => {
    for (const url of ["/api/projects", "/api/tickets", "/api/tickets/HND-1", "/api/graph", "/api/audit"]) expect((await send("GET", url)).statusCode, url).toBe(200);
  });

  it.each([
    ["POST", "/api/projects/sync"],
    ["PATCH", "/api/projects/HND"],
    ["PUT", "/api/projects/HND/rules"],
    ["POST", "/api/projects/HND/ingest"],
    ["POST", "/api/tickets/HND-1/summarize"],
    ["POST", "/api/connection/test"],
  ] as const)("blocks %s %s with 403 and does nothing", async (method, url) => {
    const r = await send(method, url, { enabled: false, rules: [] });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/read-only/i);
    expect(queued).toEqual([]);
  });

  it("leaves data unchanged after the blocked writes", async () => {
    expect((await prisma.project.findUniqueOrThrow({ where: { key: "HND" } })).enabled).toBe(true);
    expect(await prisma.policyRule.count()).toBe(1);
  });

  it("still lets visitors ask questions", async () => {
    const r = await send("POST", "/api/chat", { message: "Why does checkout time out under load?" });
    expect(r.statusCode).toBe(200);
    expect(r.json().message.role).toBe("assistant");
  });

  it("does not list other visitors' conversations", async () => {
    expect((await send("GET", "/api/chat/sessions")).json()).toEqual([]);
  });

  it("an existing session is still readable by its (unguessable) id", async () => {
    const id = (await send("POST", "/api/chat", { message: "checkout times out" })).json().sessionId as string;
    expect((await send("GET", `/api/chat/sessions/${id}`)).statusCode).toBe(200);
  });
});

describe("daily chat budget", () => {
  it("returns 429 once the daily limit is used up, and says why", async () => {
    await start({ readOnly: true, chatDailyLimit: 2 });
    expect((await send("POST", "/api/chat", { message: "checkout times out" })).statusCode).toBe(200);
    expect((await send("POST", "/api/chat", { message: "checkout times out" })).statusCode).toBe(200);
    const r = await send("POST", "/api/chat", { message: "checkout times out" });
    expect(r.statusCode).toBe(429);
    expect(r.json().error).toMatch(/daily/i);
  });

  it("does not count rejected requests against the budget", async () => {
    await start({ readOnly: true, chatDailyLimit: 1 });
    expect((await send("POST", "/api/chat", { message: "   " })).statusCode).toBe(400);
    expect((await send("POST", "/api/chat", { message: "checkout times out" })).statusCode).toBe(200);
  });
});

describe("normal mode is unchanged", () => {
  beforeAll(() => start({}));
  it("allows writes", async () => {
    expect((await send("PATCH", "/api/projects/HND", { enabled: true })).statusCode).toBe(200);
  });
  it("lists conversations", async () => {
    expect(((await send("GET", "/api/chat/sessions")).json() as unknown[]).length).toBeGreaterThan(0);
  });
  it("reports readOnly false", async () => {
    expect((await send("GET", "/api/connection")).json()).toMatchObject({ readOnly: false });
  });
});
