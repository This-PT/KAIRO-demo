import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@handover/db";
import { FixtureConnector } from "@handover/connectors";
import type { Rule } from "@handover/policy";
import { decrypt } from "./crypto";
import { ingestProject } from "./ingest";

const key = randomBytes(32).toString("base64");
const rules: Rule[] = [
  { label: null, visibility: "readable" },
  { label: "hr-confidential", visibility: "restricted" },
];
let projectId = "";

async function wipe() {
  const p = await prisma.project.findUnique({ where: { key: "HND" } });
  if (!p) return;
  await prisma.redactionEvent.deleteMany({ where: { ticket: { projectId: p.id } } });
  await prisma.ticketLink.deleteMany({ where: { from: { projectId: p.id } } });
  await prisma.ticketContent.deleteMany({ where: { ticket: { projectId: p.id } } });
  await prisma.ticket.deleteMany({ where: { projectId: p.id } });
  await prisma.ingestRun.deleteMany({ where: { projectId: p.id } });
  await prisma.project.delete({ where: { id: p.id } });
  await prisma.connection.deleteMany({ where: { id: p.connectionId } });
}

beforeAll(async () => {
  await wipe();
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  projectId = (await prisma.project.create({ data: { key: "HND", name: "Handover Demo", connectionId: conn.id, enabled: true } })).id;
});
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe("ingestProject", () => {
  const enqueued: string[] = [];
  const run = () =>
    ingestProject({
      connector: new FixtureConnector(),
      db: prisma,
      projectKey: "HND",
      rules,
      encryptionKey: key,
      pageSize: 3,
      enqueueSummarize: async (k) => void enqueued.push(k),
    });

  it("ingests all fixtures, restricting HR and enqueueing only readable tickets", async () => {
    const r = await run();
    expect(r).toMatchObject({ fetched: 10, restricted: 1, readable: 9, skipped: 0 });
    expect(enqueued.sort()).toEqual(["HND-1", "HND-10", "HND-2", "HND-3", "HND-4", "HND-5", "HND-7", "HND-8", "HND-9"]);
  });
  it("stores the hierarchy; labels and assignee only for readable tickets", async () => {
    const sub = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-4" } });
    expect(sub).toMatchObject({ issueType: "Sub-task", parentKey: "HND-1" });
    const epic = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-9" } });
    expect(epic).toMatchObject({ issueType: "Epic", parentKey: null });
    const readable = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-1" } });
    expect(readable.labels).toEqual(["backend"]);
    expect(readable.assignee).toBe("Dana Kim");
    const hr = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-6" } });
    expect(hr.labels).toEqual([]);
    expect(hr.assignee).toBeNull();
    expect(hr.issueType).toBe("Task");
  });
  it("stores restricted content only encrypted, with no plaintext anywhere", async () => {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-6" }, include: { content: true } });
    expect(t.visibility).toBe("restricted");
    expect(t.content!.redactedText).toBeNull();
    expect(t.content!.structured).toBeNull();
    expect(Buffer.from(t.content!.rawEncrypted!).toString("utf8")).not.toContain("120k");
    expect(decrypt(Buffer.from(t.content!.rawEncrypted!), key)).toContain("120k-150k");
  });
  it("stores readable content redacted and records redaction counts without values", async () => {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-2" }, include: { content: true, redactions: true } });
    expect(t.content!.redactedText).not.toContain("sk_live_");
    expect(t.content!.redactedText).not.toContain("Sup3rS3cret");
    expect(t.content!.redactedText).toContain("[REDACTED:api_key]");
    expect(t.content!.rawEncrypted).toBeNull();
    expect(t.redactions.map((x) => x.type).sort()).toEqual(["api_key", "email", "password"]);
    expect(JSON.stringify(t.redactions)).not.toContain("sk_live");
  });
  it("persists links", async () => {
    const links = await prisma.ticketLink.findMany({ where: { from: { key: "HND-1" } } });
    expect(links.map((l) => l.toKey)).toEqual(["HND-4"]);
  });
  it("is idempotent: unchanged tickets are skipped and not re-enqueued", async () => {
    enqueued.length = 0;
    const r = await run();
    expect(r).toMatchObject({ fetched: 10, skipped: 10, readable: 0, restricted: 0 });
    expect(enqueued).toEqual([]);
    expect(await prisma.ticket.count({ where: { projectId } })).toBe(10);
  });
  it("updates hierarchy-only changes (e.g. a new parent) without re-summarizing", async () => {
    enqueued.length = 0;
    const base = new FixtureConnector();
    const moved = {
      listProjects: () => base.listProjects(),
      fetchIssues: async (...a: Parameters<FixtureConnector["fetchIssues"]>) => {
        const page = await base.fetchIssues(...a);
        return { ...page, tickets: page.tickets.map((t) => (t.key === "HND-8" ? { ...t, parent: "HND-9", assignee: "New Person" } : t)) };
      },
    };
    const r = await ingestProject({ connector: moved, db: prisma, projectKey: "HND", rules, encryptionKey: key, enqueueSummarize: async (k) => void enqueued.push(k) });
    expect(r).toMatchObject({ skipped: 10, readable: 0, restricted: 0 });
    expect(enqueued).toEqual([]);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-8" } });
    expect(t).toMatchObject({ parentKey: "HND-9", assignee: "New Person" });
  });
  it("re-processes a ticket when policy changes its visibility", async () => {
    enqueued.length = 0;
    const r = await ingestProject({
      connector: new FixtureConnector(),
      db: prisma,
      projectKey: "HND",
      rules: [{ label: null, visibility: "readable" }],
      encryptionKey: key,
      enqueueSummarize: async (k) => void enqueued.push(k),
    });
    expect(r.readable).toBe(1);
    expect(enqueued).toEqual(["HND-6"]);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-6" }, include: { content: true } });
    expect(t.visibility).toBe("readable");
    expect(t.content!.rawEncrypted).toBeNull();
  });
  it("records an ingest run", async () => {
    const runs = await prisma.ingestRun.findMany({ where: { projectId } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.every((x) => x.status === "done")).toBe(true);
  });
});
