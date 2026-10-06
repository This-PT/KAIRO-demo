import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HeuristicProvider, summarizeStoredTicket } from "@handover/ai";
import { FixtureConnector } from "@handover/connectors";
import { prisma, wipeProject } from "@handover/db";
import { buildApp, type JobQueues } from "./app";
import { processIngest } from "./jobs";

const TOKEN = "test-admin-token-123";
const ENC = randomBytes(32).toString("base64");
const auth = { authorization: `Bearer ${TOKEN}` };

const queued = { ingest: [] as string[], summarize: [] as string[] };
const queues: JobQueues = {
  enqueueIngest: async (k) => (queued.ingest.push(k), `ingest-${k}`),
  enqueueSummarize: async (k) => (queued.summarize.push(k), `summarize-${k}`),
};

let app: FastifyInstance;
const get = (url: string, headers: Record<string, string> = auth) => app.inject({ method: "GET", url, headers });
const send = (method: "POST" | "PUT" | "PATCH", url: string, payload?: unknown) => app.inject({ method, url, headers: auth, payload: payload as object });

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  app = await buildApp({
    db: prisma,
    queues,
    connector: new FixtureConnector(),
    provider: new HeuristicProvider(),
    config: { adminToken: TOKEN, webOrigin: "http://localhost:3000", connection: { mode: "demo", baseUrl: "fixtures" } },
  });
});
afterAll(async () => {
  await app.close();
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});
beforeEach(() => {
  queued.ingest.length = 0;
  queued.summarize.length = 0;
});

describe("auth", () => {
  it("/health is open", async () => expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200));
  it("rejects missing and wrong tokens on /api routes", async () => {
    expect((await get("/api/projects", {})).statusCode).toBe(401);
    expect((await get("/api/projects", { authorization: "Bearer nope" })).statusCode).toBe(401);
    expect((await get("/api/projects", { authorization: TOKEN })).statusCode).toBe(401);
  });
  it("accepts the admin token", async () => expect((await get("/api/projects")).statusCode).toBe(200));
});

describe("request bodies", () => {
  const raw = (url: string, payload: string | undefined) =>
    app.inject({ method: "POST", url, headers: { ...auth, "content-type": "application/json" }, payload });
  it("accepts an empty body even when content-type is application/json (browsers send this)", async () => {
    expect((await raw("/api/projects/sync", undefined)).statusCode).toBe(200);
    expect((await raw("/api/projects/sync", "")).statusCode).toBe(200);
  });
  it("still rejects malformed JSON with 400", async () => {
    const r = await app.inject({ method: "PATCH", url: "/api/projects/HND", headers: { ...auth, "content-type": "application/json" }, payload: "{not json" });
    expect(r.statusCode).toBe(400);
  });
});

describe("connection", () => {
  it("reports mode and base URL and never leaks secrets", async () => {
    const r = await get("/api/connection");
    expect(r.json()).toMatchObject({ mode: "demo", baseUrl: "fixtures" });
    expect(r.body).not.toContain(TOKEN);
  });
  it("tests the connection by listing projects", async () => {
    const r = await send("POST", "/api/connection/test");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, projects: [{ key: "HND", name: "Handover Demo" }] });
  });
});

describe("projects and rules", () => {
  it("syncs projects from the connector, disabled by default", async () => {
    expect((await send("POST", "/api/projects/sync")).statusCode).toBe(200);
    const list = (await get("/api/projects")).json() as { key: string; enabled: boolean; ticketCount: number }[];
    expect(list).toEqual([expect.objectContaining({ key: "HND", enabled: false, ticketCount: 0 })]);
  });
  it("sync is idempotent and keeps the enabled flag", async () => {
    await send("PATCH", "/api/projects/HND", { enabled: true });
    await send("POST", "/api/projects/sync");
    const list = (await get("/api/projects")).json() as { enabled: boolean }[];
    expect(list).toHaveLength(1);
    expect(list[0]!.enabled).toBe(true);
    await send("PATCH", "/api/projects/HND", { enabled: false });
  });
  it("validates PATCH bodies and unknown projects", async () => {
    expect((await send("PATCH", "/api/projects/HND", { enabled: "yes" })).statusCode).toBe(400);
    expect((await send("PATCH", "/api/projects/NOPE", { enabled: true })).statusCode).toBe(404);
  });
  it("starts with no rules (default restricted)", async () => expect((await get("/api/projects/HND/rules")).json()).toEqual({ rules: [] }));
  it("validates rules", async () => {
    expect((await send("PUT", "/api/projects/HND/rules", { rules: [{ label: null, visibility: "public" }] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/projects/HND/rules", { rules: [{ label: "  ", visibility: "readable" }] })).statusCode).toBe(400);
    expect((await send("PUT", "/api/projects/HND/rules", {})).statusCode).toBe(400);
    expect((await send("PUT", "/api/projects/NOPE/rules", { rules: [] })).statusCode).toBe(404);
  });
  it("replaces the whole rule set on PUT", async () => {
    const a = { rules: [{ label: null, visibility: "readable" }, { label: "hr-confidential", visibility: "restricted" }] };
    expect((await send("PUT", "/api/projects/HND/rules", a)).statusCode).toBe(200);
    expect((await get("/api/projects/HND/rules")).json()).toEqual(a);
    await send("PUT", "/api/projects/HND/rules", { rules: [a.rules[0]] });
    expect((await get("/api/projects/HND/rules")).json()).toEqual({ rules: [a.rules[0]] });
    await send("PUT", "/api/projects/HND/rules", a);
  });
});

describe("ingest trigger", () => {
  it("404s for unknown and 409s for disabled projects", async () => {
    expect((await send("POST", "/api/projects/NOPE/ingest")).statusCode).toBe(404);
    expect((await send("POST", "/api/projects/HND/ingest")).statusCode).toBe(409);
    expect(queued.ingest).toEqual([]);
  });
  it("queues an ingest for enabled projects", async () => {
    await send("PATCH", "/api/projects/HND", { enabled: true });
    const r = await send("POST", "/api/projects/HND/ingest");
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ jobId: "ingest-HND" });
    expect(queued.ingest).toEqual(["HND"]);
  });
  it("re-queues ingest when rules change on an enabled project so old visibility never lingers", async () => {
    await send("PUT", "/api/projects/HND/rules", { rules: [{ label: null, visibility: "readable" }] });
    expect(queued.ingest).toEqual(["HND"]);
    await send("PUT", "/api/projects/HND/rules", { rules: [{ label: null, visibility: "readable" }, { label: "hr-confidential", visibility: "restricted" }] });
  });
});

describe("tickets", () => {
  beforeAll(async () => {
    await processIngest({ db: prisma, connector: new FixtureConnector(), encryptionKey: ENC, queues }, "HND");
    await summarizeStoredTicket({ db: prisma, provider: new HeuristicProvider(), ticketKey: "HND-1" });
  });

  it("lists tickets with summary status", async () => {
    const r = (await get("/api/tickets")).json() as { total: number; items: any[] };
    expect(r.total).toBe(10);
    const t1 = r.items.find((t) => t.key === "HND-1");
    expect(t1).toMatchObject({ visibility: "readable", url: "https://fake.atlassian.net/browse/HND-1", summary: { status: "ok", confidence: "low" } });
    expect(r.items.find((t) => t.key === "HND-3").summary).toBeNull();
  });
  it("filters by visibility, text and paginates", async () => {
    expect(((await get("/api/tickets?visibility=restricted")).json() as { items: unknown[] }).items).toHaveLength(1);
    const q = (await get("/api/tickets?q=checkout")).json() as { items: { key: string }[] };
    expect(q.items.map((t) => t.key)).toEqual(["HND-9", "HND-1"]);
    const page = (await get("/api/tickets?limit=3&offset=3")).json() as { total: number; items: unknown[] };
    expect(page.total).toBe(10);
    expect(page.items).toHaveLength(3);
    expect((await get("/api/tickets?limit=9999")).statusCode).toBe(400);
  });
  it("never searches or shows restricted titles", async () => {
    expect(((await get("/api/tickets?q=salary")).json() as { items: unknown[] }).items).toEqual([]);
    const r = (await get("/api/tickets?visibility=restricted")).json() as { items: any[] };
    expect(r.items[0].title).toBe("[Restricted]");
  });
  it("returns the structured summary and source link for a readable ticket", async () => {
    const r = (await get("/api/tickets/HND-1")).json();
    expect(r).toMatchObject({ key: "HND-1", visibility: "readable", url: "https://fake.atlassian.net/browse/HND-1" });
    expect(r.summary.json.ticket).toBe("HND-1");
    expect(r.summary).toMatchObject({ status: "ok", confidence: "low", model: "heuristic-v1" });
  });
  it("includes the redacted original text for readable tickets so the source can be read in the app", async () => {
    const r = (await get("/api/tickets/HND-2")).json();
    expect(r.sourceText).toContain("Stripe webhook leaks key in logs");
    expect(r.sourceText).toContain("[REDACTED:api_key]");
    expect(r.sourceText).not.toContain("sk_live_");
    expect(r.sourceText).not.toContain("Sup3rS3cret");
  });
  it("returns metadata only for restricted tickets", async () => {
    const r = await get("/api/tickets/HND-6");
    const body = r.json();
    expect(body).toMatchObject({ key: "HND-6", visibility: "restricted", title: "[Restricted]", summary: null });
    expect(r.body).not.toMatch(/120k|salary|confidential/i);
    expect(body.sourceText ?? null).toBeNull();
  });
  it("404s for unknown tickets", async () => expect((await get("/api/tickets/NOPE-1")).statusCode).toBe(404));

  it("queues a re-summarize for readable tickets only", async () => {
    expect((await send("POST", "/api/tickets/HND-6/summarize")).statusCode).toBe(409);
    expect((await send("POST", "/api/tickets/NOPE-1/summarize")).statusCode).toBe(404);
    expect((await send("POST", "/api/tickets/HND-1/summarize")).statusCode).toBe(202);
    expect(queued.summarize).toEqual(["HND-1"]);
  });
});

describe("graph", () => {
  it("requires auth", async () => expect((await get("/api/graph", {})).statusCode).toBe(401));

  it("returns the hierarchy, link edges and masked restricted nodes", async () => {
    const g = (await get("/api/graph")).json() as { nodes: any[]; edges: any[]; truncated: boolean };
    expect(g.nodes).toHaveLength(10);
    expect(g.truncated).toBe(false);
    const byKey = Object.fromEntries(g.nodes.map((n) => [n.key, n]));
    expect(byKey["HND-9"]).toMatchObject({ issueType: "Epic", parent: null });
    expect(byKey["HND-1"]).toMatchObject({ parent: "HND-9", assignee: "Dana Kim" });
    expect(byKey["HND-4"]).toMatchObject({ issueType: "Sub-task", parent: "HND-1" });
    expect(byKey["HND-6"]).toMatchObject({ title: "[Restricted]", visibility: "restricted", assignee: null, labels: [], summary: null });
    expect(g.edges).toEqual(expect.arrayContaining([expect.objectContaining({ type: "relates to" }), expect.objectContaining({ type: "blocks" })]));
  });

  it("never leaks restricted content", async () => {
    const r = await get("/api/graph");
    expect(r.body).not.toMatch(/120k|salary|hr-confidential|HR Team/i);
  });

  it("filters by label and person with ancestors", async () => {
    const byLabel = (await get("/api/graph?label=auth")).json() as { nodes: { key: string }[] };
    expect(byLabel.nodes.map((n) => n.key).sort()).toEqual(["HND-10", "HND-3", "HND-5"]);
    const byPerson = (await get("/api/graph?person=raj%20patel")).json() as { nodes: { key: string }[] };
    expect(byPerson.nodes.map((n) => n.key).sort()).toEqual(["HND-1", "HND-4", "HND-9"]);
  });

  it("returns filter options built from readable tickets only", async () => {
    const g = (await get("/api/graph")).json() as { facets: { labels: string[]; people: string[]; projects: string[] } };
    expect(g.facets.projects).toEqual(["HND"]);
    expect(g.facets.labels).toEqual(expect.arrayContaining(["auth", "backend", "epic"]));
    expect(g.facets.people).toEqual(expect.arrayContaining(["Dana Kim", "Mia Torres", "Raj Patel"]));
    expect(g.facets.labels).not.toContain("hr-confidential");
    expect(g.facets.people).not.toContain("HR Team");
  });

  it("keeps the filter options complete even when the graph is filtered", async () => {
    const g = (await get("/api/graph?label=auth")).json() as { nodes: unknown[]; facets: { labels: string[] } };
    expect(g.nodes).toHaveLength(3);
    expect(g.facets.labels).toContain("backend");
  });

  it("rejects absurd query values", async () => {
    expect((await get("/api/graph?label=" + "x".repeat(300))).statusCode).toBe(400);
  });
});

describe("audit log", () => {
  it("shows what was sent to the LLM and when", async () => {
    const r = (await get("/api/audit?ticket=HND-1")).json() as { items: any[] };
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]).toMatchObject({ ticketKey: "HND-1", provider: "heuristic", outcome: "ok" });
    expect(r.items[0].payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.items[0].payloadSnapshot).toContain("HND-1");
    expect(r.items[0].sentAt).toBeTruthy();
  });
  it("is empty for restricted tickets, which are never sent", async () => {
    expect(((await get("/api/audit?ticket=HND-6")).json() as { items: unknown[] }).items).toEqual([]);
  });
});
