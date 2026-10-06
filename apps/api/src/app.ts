import { createHash, timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import { answerQuestion, type LlmProvider } from "@kairo/ai";
import type { Connector } from "@kairo/connectors";
import type { PrismaClient } from "@kairo/db";
import { redact } from "@kairo/policy";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { ConnectionInfo } from "./config";
import { buildGraph } from "./graph";

export interface JobQueues {
  enqueueIngest(projectKey: string): Promise<string>;
  enqueueSummarize(ticketKey: string): Promise<string>;
}

export interface AppDeps {
  db: PrismaClient;
  queues: JobQueues;
  connector: Connector;
  provider: LlmProvider;
  config: { adminToken: string; webOrigin: string; connection: ConnectionInfo; chatRateLimitPerMinute?: number; readOnly?: boolean; chatDailyLimit?: number };
}

const RESTRICTED_TITLE = "[Restricted]";
const sha = (s: string) => createHash("sha256").update(s).digest();

const RulesBody = z.object({
  rules: z
    .array(z.object({ label: z.string().trim().min(1).max(200).nullable(), visibility: z.enum(["readable", "restricted"]) }))
    .max(200),
});
const EnabledBody = z.object({ enabled: z.boolean() });
const TicketQuery = z.object({
  project: z.string().optional(),
  visibility: z.enum(["readable", "restricted"]).optional(),
  status: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const GraphQuery = z.object({ project: z.string().trim().min(1).max(100).optional(), label: z.string().trim().min(1).max(100).optional(), person: z.string().trim().min(1).max(100).optional() });
const ChatBody = z.object({ sessionId: z.string().min(1).max(64).optional(), message: z.string().trim().min(1).max(2000) });
const AuditQuery = z.object({ ticket: z.string().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });

export async function buildApp(d: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: d.config.webOrigin, methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"], allowedHeaders: ["authorization", "content-type"] });

  // Browsers may send content-type: application/json with no body (e.g. action buttons). Treat that as "no body".
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      const err = new Error("invalid JSON body") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  const expected = sha(d.config.adminToken);
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS" || !req.url.startsWith("/api/")) return;
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
    if (!m || !timingSafeEqual(sha(m[1]!), expected)) return reply.code(401).send({ error: "unauthorized" });
  });

  // Public demo mode: visitors may read and ask questions, but nothing can be changed or triggered.
  const readOnly = d.config.readOnly ?? false;
  app.addHook("onRequest", async (req, reply) => {
    if (!readOnly || !req.url.startsWith("/api/") || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    if (req.method === "POST" && req.url.split("?")[0] === "/api/chat") return;
    return reply.code(403).send({ error: "This is a read-only demo. Changes are disabled." });
  });

  const bad = (reply: { code(n: number): { send(b: unknown): unknown } }, e: z.ZodError) => reply.code(400).send({ error: "invalid request", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
  const findProject = (key: string) => d.db.project.findUnique({ where: { key } });

  app.get("/health", async () => ({ ok: true }));

  // ---- connection ----
  app.get("/api/connection", async () => ({ ...d.config.connection, readOnly }));
  app.post("/api/connection/test", async (_req, reply) => {
    try {
      return { ok: true, projects: await d.connector.listProjects() };
    } catch (e) {
      return reply.code(502).send({ ok: false, error: e instanceof Error ? e.message : "connection failed" });
    }
  });

  // ---- projects ----
  const projectList = async () => {
    const rows = await d.db.project.findMany({ orderBy: { key: "asc" }, include: { _count: { select: { tickets: true } } } });
    return rows.map((p) => ({ key: p.key, name: p.name, enabled: p.enabled, ticketCount: p._count.tickets }));
  };
  app.get("/api/projects", projectList);
  app.post("/api/projects/sync", async () => {
    const { baseUrl, mode } = d.config.connection;
    const conn =
      (await d.db.connection.findFirst({ where: { baseUrl } })) ??
      (await d.db.connection.create({ data: { type: mode === "demo" ? "fixtures" : "jira", baseUrl, status: "connected" } }));
    for (const p of await d.connector.listProjects()) {
      await d.db.project.upsert({ where: { key: p.key }, create: { key: p.key, name: p.name, connectionId: conn.id, enabled: false }, update: { name: p.name } });
    }
    return projectList();
  });
  app.patch<{ Params: { key: string } }>("/api/projects/:key", async (req, reply) => {
    const body = EnabledBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    if (!(await findProject(req.params.key))) return reply.code(404).send({ error: "project not found" });
    await d.db.project.update({ where: { key: req.params.key }, data: { enabled: body.data.enabled } });
    return { key: req.params.key, enabled: body.data.enabled };
  });

  // ---- policy rules ----
  app.get<{ Params: { key: string } }>("/api/projects/:key/rules", async (req, reply) => {
    const p = await d.db.project.findUnique({ where: { key: req.params.key }, include: { rules: { orderBy: { id: "asc" } } } });
    if (!p) return reply.code(404).send({ error: "project not found" });
    return { rules: p.rules.map((r) => ({ label: r.label, visibility: r.visibility })) };
  });
  app.put<{ Params: { key: string } }>("/api/projects/:key/rules", async (req, reply) => {
    const body = RulesBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const p = await findProject(req.params.key);
    if (!p) return reply.code(404).send({ error: "project not found" });
    await d.db.$transaction([
      d.db.policyRule.deleteMany({ where: { projectId: p.id } }),
      d.db.policyRule.createMany({ data: body.data.rules.map((r, i) => ({ projectId: p.id, label: r.label, visibility: r.visibility, priority: i })) }),
    ]);
    // Stored visibility only changes on ingest, so re-run it now rather than leave stale access in place.
    const reingestJobId = p.enabled ? await d.queues.enqueueIngest(p.key) : null;
    return { rules: body.data.rules, reingestJobId };
  });

  // ---- ingest ----
  app.post<{ Params: { key: string } }>("/api/projects/:key/ingest", async (req, reply) => {
    const p = await findProject(req.params.key);
    if (!p) return reply.code(404).send({ error: "project not found" });
    if (!p.enabled) return reply.code(409).send({ error: "project is not enabled" });
    return reply.code(202).send({ jobId: await d.queues.enqueueIngest(p.key) });
  });

  // ---- tickets ----
  app.get("/api/tickets", async (req, reply) => {
    const q = TicketQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    const where = {
      ...(q.data.project ? { project: { key: q.data.project } } : {}),
      ...(q.data.status ? { status: q.data.status } : {}),
      // Restricted titles are placeholders, so text search only ever looks at readable tickets.
      ...(q.data.q ? { visibility: "readable" as const, title: { contains: q.data.q, mode: "insensitive" as const } } : q.data.visibility ? { visibility: q.data.visibility } : {}),
    };
    const [total, rows] = await Promise.all([
      d.db.ticket.count({ where }),
      d.db.ticket.findMany({
        where,
        orderBy: [{ sourceUpdatedAt: "desc" }, { key: "asc" }],
        take: q.data.limit,
        skip: q.data.offset,
        include: { project: { select: { key: true } }, summaries: { orderBy: { createdAt: "desc" }, take: 1 } },
      }),
    ]);
    return {
      total,
      items: rows.map((t) => ({
        key: t.key,
        project: t.project.key,
        title: t.title,
        status: t.status,
        visibility: t.visibility,
        url: t.url,
        updated: t.sourceUpdatedAt,
        summary: t.summaries[0] ? { status: t.summaries[0].status, confidence: t.summaries[0].confidence } : null,
      })),
    };
  });

  app.get<{ Params: { key: string } }>("/api/tickets/:key", async (req, reply) => {
    const t = await d.db.ticket.findUnique({
      where: { key: req.params.key },
      include: { project: { select: { key: true } }, summaries: { orderBy: { createdAt: "desc" }, take: 1 }, content: { select: { redactedText: true } } },
    });
    if (!t) return reply.code(404).send({ error: "ticket not found" });
    const base = { key: t.key, project: t.project.key, url: t.url, visibility: t.visibility, updated: t.sourceUpdatedAt };
    if (t.visibility === "restricted") return { ...base, title: RESTRICTED_TITLE, status: "restricted", summary: null, sourceText: null };
    const s = t.summaries[0];
    return {
      ...base,
      title: t.title,
      status: t.status,
      // Already redacted by the policy filter; readable tickets only.
      sourceText: t.content?.redactedText ?? null,
      summary: s
        ? { id: s.id, status: s.status, confidence: s.confidence, model: s.model, promptVersion: s.promptVersion, attempts: s.attempts, evidenceVerified: s.evidenceVerified, createdAt: s.createdAt, json: s.json }
        : null,
    };
  });

  app.post<{ Params: { key: string } }>("/api/tickets/:key/summarize", async (req, reply) => {
    const t = await d.db.ticket.findUnique({ where: { key: req.params.key } });
    if (!t) return reply.code(404).send({ error: "ticket not found" });
    if (t.visibility !== "readable") return reply.code(409).send({ error: "ticket is restricted" });
    return reply.code(202).send({ jobId: await d.queues.enqueueSummarize(t.key) });
  });

  // ---- work tree graph ----
  const MAX_GRAPH_NODES = 2000;
  app.get("/api/graph", async (req, reply) => {
    const q = GraphQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    const rows = await d.db.ticket.findMany({
      orderBy: [{ sourceUpdatedAt: "asc" }, { key: "asc" }],
      take: MAX_GRAPH_NODES + 1,
      include: { project: { select: { key: true } }, summaries: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    const truncated = rows.length > MAX_GRAPH_NODES;
    const tickets = rows.slice(0, MAX_GRAPH_NODES).map((t) => ({
      key: t.key,
      project: t.project.key,
      title: t.title,
      issueType: t.issueType,
      status: t.status,
      visibility: t.visibility,
      parentKey: t.parentKey,
      assignee: t.assignee,
      labels: t.labels,
      url: t.url,
      summary: t.summaries[0] ? { status: t.summaries[0].status, confidence: t.summaries[0].confidence } : null,
    }));
    const links = (await d.db.ticketLink.findMany({ include: { from: { select: { key: true } } } })).map((l) => ({ from: l.from.key, to: l.toKey, type: l.type }));
    // Filter options come from the full set of readable tickets, so they never reveal restricted details and do not shrink when filtered.
    const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b));
    const readable = tickets.filter((t) => t.visibility === "readable");
    const facets = {
      projects: uniq(tickets.map((t) => t.project)),
      labels: uniq(readable.flatMap((t) => t.labels)),
      people: uniq(readable.flatMap((t) => (t.assignee ? [t.assignee] : []))),
    };
    return { ...buildGraph(tickets, links, q.data), facets, truncated };
  });

  // ---- chat ----
  // Simple per-process limit so a stray loop cannot run up the AI bill.
  const chatLimit = d.config.chatRateLimitPerMinute ?? 20;
  const chatHits: number[] = [];
  const chatLimited = () => {
    const now = Date.now();
    while (chatHits.length && now - chatHits[0]! > 60_000) chatHits.shift();
    if (chatHits.length >= chatLimit) return true;
    chatHits.push(now);
    return false;
  };

  // Daily budget for model calls, so a public demo cannot run up the AI bill. Counted only for requests that reach the model.
  const dailyLimit = d.config.chatDailyLimit ?? (readOnly ? 200 : undefined);
  let budgetDay = "";
  let budgetUsed = 0;
  const dailyBudgetUsed = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (budgetDay !== today) {
      budgetDay = today;
      budgetUsed = 0;
    }
    if (dailyLimit !== undefined && budgetUsed >= dailyLimit) return true;
    budgetUsed++;
    return false;
  };

  // The web server sets x-visitor-id (an anonymous per-browser id) and the browser cannot choose it.
  // undefined = no header (admin token used directly: sees everything), null = malformed, string = a valid visitor.
  const VISITOR_RE = /^[a-f0-9]{32}$/;
  const visitorOf = (req: { headers: Record<string, unknown> }): string | null | undefined => {
    const h = req.headers["x-visitor-id"];
    if (h === undefined) return undefined;
    const v = Array.isArray(h) ? h[0] : h;
    return typeof v === "string" && VISITOR_RE.test(v) ? v : null;
  };

  type StoredCitations = { status: string; citations: unknown[]; sources: unknown[]; scope?: string } | null;
  const toMessage = (m: { id: string; role: string; content: string; citations: unknown; confidence: string | null; createdAt: Date }) => {
    const extra = (m.citations ?? null) as StoredCitations;
    return m.role === "assistant"
      ? { id: m.id, role: m.role, content: m.content, status: extra?.status ?? "answered", citations: extra?.citations ?? [], sources: extra?.sources ?? [], scope: extra?.scope ?? "search", confidence: m.confidence, createdAt: m.createdAt }
      : { id: m.id, role: m.role, content: m.content, createdAt: m.createdAt };
  };

  app.post("/api/chat", async (req, reply) => {
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return bad(reply, body.error);
    const visitor = visitorOf(req);
    if (visitor === null) return reply.code(400).send({ error: "invalid visitor id" });
    if (chatLimited()) return reply.code(429).header("retry-after", "60").send({ error: "Too many questions. Try again in a minute." });

    let sessionId = body.data.sessionId ?? null;
    let history: { role: "user" | "assistant"; content: string }[] = [];
    if (sessionId) {
      const s = await d.db.chatSession.findFirst({ where: { id: sessionId, ...(visitor ? { ownerId: visitor } : {}) }, include: { messages: { orderBy: { createdAt: "desc" }, take: 6 } } });
      if (!s) return reply.code(404).send({ error: "chat session not found" });
      history = s.messages.reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    }

    if (dailyBudgetUsed()) return reply.code(429).send({ error: "The daily limit for demo questions has been reached. Please try again tomorrow." });

    const question = redact(body.data.message).text;
    let result;
    try {
      result = await answerQuestion({ db: d.db, provider: d.provider, question, history });
    } catch {
      // Provider errors can echo request details, so only a generic message leaves the server.
      return reply.code(502).send({ error: "The AI service failed. Please try again." });
    }

    const session = sessionId ? { id: sessionId } : await d.db.chatSession.create({ data: { title: question.slice(0, 60), ownerId: visitor ?? null } });
    sessionId = session.id;
    const t0 = new Date();
    await d.db.chatMessage.create({ data: { sessionId, role: "user", content: question, createdAt: t0 } });
    const saved = await d.db.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: result.answer,
        citations: { status: result.status, citations: result.citations, sources: result.sources, scope: result.scope } as object,
        confidence: result.confidence,
        notFound: result.status === "not_found" || result.status === "no_sources",
        createdAt: new Date(t0.getTime() + 1),
      },
    });
    return { sessionId, message: toMessage(saved) };
  });

  app.get("/api/chat/sessions", async (req, reply) => {
    const visitor = visitorOf(req);
    if (visitor === null) return reply.code(400).send({ error: "invalid visitor id" });
    // A visitor sees only their own conversations. Without a visitor id (admin), a public read-only demo shows nothing.
    if (!visitor && readOnly) return [];
    const rows = await d.db.chatSession.findMany({ where: visitor ? { ownerId: visitor } : {}, orderBy: { createdAt: "desc" }, take: 30 });
    return rows.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt }));
  });

  app.get<{ Params: { id: string } }>("/api/chat/sessions/:id", async (req, reply) => {
    const visitor = visitorOf(req);
    if (visitor === null) return reply.code(400).send({ error: "invalid visitor id" });
    const s = await d.db.chatSession.findFirst({ where: { id: req.params.id, ...(visitor ? { ownerId: visitor } : {}) }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!s) return reply.code(404).send({ error: "chat session not found" });
    return { id: s.id, title: s.title, messages: s.messages.map(toMessage) };
  });

  // ---- audit ----
  app.get("/api/audit", async (req, reply) => {
    const q = AuditQuery.safeParse(req.query);
    if (!q.success) return bad(reply, q.error);
    const rows = await d.db.auditLog.findMany({
      where: q.data.ticket ? { ticket: { key: q.data.ticket } } : {},
      orderBy: { sentAt: "desc" },
      take: q.data.limit,
      include: { ticket: { select: { key: true } } },
    });
    return {
      items: rows.map((a) => ({
        id: a.id,
        kind: a.kind,
        ticketKey: a.ticket?.key ?? null,
        ticketKeys: a.ticket ? [a.ticket.key] : a.ticketKeys,
        sentAt: a.sentAt,
        provider: a.provider,
        model: a.model,
        payloadHash: a.payloadHash,
        payloadSnapshot: a.payloadSnapshot,
        bytes: a.bytes,
        outcome: a.outcome,
      })),
    };
  });

  return app;
}
