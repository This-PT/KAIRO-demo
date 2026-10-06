import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider, type LlmProvider } from "@handover/ai";
import { prisma, wipeProject } from "@handover/db";
import { runDemo } from "./demo";

const key = randomBytes(32).toString("base64");

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  await wipeProject(prisma, "SHOP");
});
afterAll(async () => {
  await wipeProject(prisma, "HND");
  await wipeProject(prisma, "SHOP");
  await prisma.$disconnect();
});

describe("runDemo (fixtures, no servers or credentials)", () => {
  it("ingests the fixtures, restricts HR data and summarizes the rest", async () => {
    const r = await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key });
    expect(r.ingest).toMatchObject({ fetched: 10, readable: 9, restricted: 1 });
    expect(r.summaries).toEqual({ ok: 9, downgraded: 0, rejected: 0 });
    const byKey = Object.fromEntries(r.tickets.map((t) => [t.key, t]));
    expect(byKey["HND-6"]).toMatchObject({ visibility: "restricted", summary: null });
    expect(byKey["HND-2"]).toMatchObject({ visibility: "readable", summary: "ok" });
  });

  it("is repeatable: a second run changes nothing and makes no new LLM calls", async () => {
    const calls: string[] = [];
    const counting: LlmProvider = {
      name: "counting",
      model: "m",
      async generate(req) {
        calls.push(req.ticketKey);
        return new HeuristicProvider().generate(req);
      },
    };
    const r = await runDemo({ db: prisma, provider: counting, encryptionKey: key });
    expect(r.ingest).toMatchObject({ fetched: 10, skipped: 10 });
    expect(calls).toEqual([]);
  });

  it("reset wipes and rebuilds from scratch", async () => {
    const r = await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key, reset: true });
    expect(r.ingest).toMatchObject({ fetched: 10, readable: 9, restricted: 1, skipped: 0 });
    expect(r.summaries.ok).toBe(9);
  });

  it("never summarizes the restricted ticket even if asked to run many times", async () => {
    await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key });
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "HND-6" } });
    expect(await prisma.auditLog.count({ where: { ticketId: t.id } })).toBe(0);
  });
});

describe("runDemo with the showcase dataset", () => {
  it("loads the Shopfront team: restricted tickets stay out, everything else is summarized", async () => {
    const r = await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key, dataset: "showcase", reset: true });
    expect(r.ingest).toMatchObject({ fetched: 25, restricted: 2, readable: 23 });
    expect(r.summaries).toEqual({ ok: 23, downgraded: 0, rejected: 0 });
    const byKey = Object.fromEntries(r.tickets.map((t) => [t.key, t]));
    expect(byKey["SHOP-21"]).toMatchObject({ visibility: "restricted", summary: null });
    expect(byKey["SHOP-22"]).toMatchObject({ visibility: "restricted", summary: null });
    expect(byKey["SHOP-2"]).toMatchObject({ visibility: "readable", summary: "ok" });
  });

  it("never sends the restricted tickets or the leaked secrets to the model", async () => {
    const t = await prisma.ticket.findMany({ where: { key: { in: ["SHOP-21", "SHOP-22"] } } });
    expect(await prisma.auditLog.count({ where: { ticketId: { in: t.map((x) => x.id) } } })).toBe(0);
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { ticket: { key: "SHOP-9" } } }));
    expect(audits).not.toMatch(/sk_live_|Winter2025Temp|tom\.becker@/);
    expect(audits).toContain("[REDACTED:");
  });

  it("is repeatable, and keeps both demo projects unless reset", async () => {
    await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key });
    const r = await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key, dataset: "showcase" });
    expect(r.ingest).toMatchObject({ fetched: 25, skipped: 25 });
    expect(await prisma.project.count({ where: { key: { in: ["HND", "SHOP"] } } })).toBe(2);
  });

  it("a showcase reset replaces the demo projects with only the showcase", async () => {
    await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key, dataset: "showcase", reset: true });
    expect(await prisma.project.count({ where: { key: "HND" } })).toBe(0);
    expect(await prisma.project.count({ where: { key: "SHOP" } })).toBe(1);
  });
});
