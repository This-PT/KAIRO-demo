import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HeuristicProvider, searchTickets } from "@handover/ai";
import { prisma, wipeProject } from "@handover/db";
import { runDemo } from "./demo";
import { exportSummaries, seedIfEmpty, seedShowcase, type SummaryExport } from "./seed";

const key = randomBytes(32).toString("base64");
let exported: SummaryExport;

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  await wipeProject(prisma, "SHOP");
  // Build a realistic export: run the showcase with the offline summarizer, export, then wipe.
  await runDemo({ db: prisma, provider: new HeuristicProvider(), encryptionKey: key, dataset: "showcase", reset: true });
  exported = await exportSummaries(prisma, "SHOP");
  await prisma.auditLog.deleteMany();
  await wipeProject(prisma, "SHOP");
});
afterAll(async () => {
  await wipeProject(prisma, "SHOP");
  await prisma.$disconnect();
});

describe("exportSummaries", () => {
  it("exports one entry per verified summary, never for restricted tickets", () => {
    expect(exported.version).toBe(1);
    expect(exported.project).toBe("SHOP");
    expect(exported.summaries).toHaveLength(23);
    const keys = exported.summaries.map((s) => s.key);
    expect(keys).not.toContain("SHOP-21");
    expect(keys).not.toContain("SHOP-22");
    expect(exported.summaries[0]).toMatchObject({ key: expect.any(String), confidence: expect.any(String), model: "heuristic-v1", promptVersion: expect.any(String), attempts: 1 });
    expect((exported.summaries[0]!.json as { ticket: string }).ticket).toBe(exported.summaries[0]!.key);
  });
  it("contains no secrets or restricted content", () => {
    const text = JSON.stringify(exported);
    expect(text).not.toMatch(/sk_live_|Winter2025Temp|tom\.becker@|95 per hour|injectable/);
  });
});

describe("seedShowcase", () => {
  it("loads the showcase without calling any AI: tickets, policy, encrypted restricted tickets and the stored summaries", async () => {
    const r = await seedShowcase({ db: prisma, encryptionKey: key, summaries: exported });
    expect(r.ingest).toMatchObject({ fetched: 25, readable: 23, restricted: 2 });
    expect(r.seeded).toBe(23);
    expect(r.invalid).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(await prisma.summary.count({ where: { ticket: { project: { key: "SHOP" } }, status: "ok" } })).toBe(23);
    expect(await prisma.auditLog.count()).toBe(0); // nothing was sent anywhere
  });

  it("keeps restricted tickets encrypted and unsummarized", async () => {
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "SHOP-21" }, include: { content: true } });
    expect(t.visibility).toBe("restricted");
    expect(t.content!.redactedText).toBeNull();
    expect(t.content!.rawEncrypted).not.toBeNull();
    expect(await prisma.summary.count({ where: { ticketId: t.id } })).toBe(0);
  });

  it("makes the seeded data searchable, exactly like summaries made by the AI", async () => {
    const hits = await searchTickets(prisma, "why did we choose elasticsearch");
    expect(hits.map((h) => h.key)).toContain("SHOP-2");
  });

  it("is idempotent", async () => {
    const r = await seedShowcase({ db: prisma, encryptionKey: key, summaries: exported });
    expect(r.seeded).toBe(0);
    expect(await prisma.summary.count({ where: { ticket: { project: { key: "SHOP" } } } })).toBe(23);
  });
});

describe("seedShowcase safety", () => {
  const reseed = async (summaries: SummaryExport) => {
    await wipeProject(prisma, "SHOP");
    return seedShowcase({ db: prisma, encryptionKey: key, summaries });
  };

  it("rejects a stored summary whose quotes are not in the ticket (stale or tampered)", async () => {
    const tampered: SummaryExport = JSON.parse(JSON.stringify(exported));
    const target = tampered.summaries.find((s) => s.key === "SHOP-2")!;
    (target.json as { evidence: { quote: string }[] }).evidence = [{ quote: "this sentence was never in the ticket at all", field: "problem" } as never];
    const r = await reseed(tampered);
    expect(r.invalid).toEqual(["SHOP-2"]);
    expect(r.seeded).toBe(22);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "SHOP-2" } });
    expect(await prisma.summary.count({ where: { ticketId: t.id } })).toBe(0);
  });

  it("ignores stored summaries for restricted tickets, even if someone adds them to the file", async () => {
    const sneaky: SummaryExport = JSON.parse(JSON.stringify(exported));
    sneaky.summaries.push({ ...sneaky.summaries[0]!, key: "SHOP-21", json: { ...(sneaky.summaries[0]!.json as object), ticket: "SHOP-21" } });
    const r = await reseed(sneaky);
    const t = await prisma.ticket.findUniqueOrThrow({ where: { key: "SHOP-21" } });
    expect(await prisma.summary.count({ where: { ticketId: t.id } })).toBe(0);
    expect(r.seeded).toBe(23);
  });

  it("reports readable tickets that have no stored summary instead of inventing one", async () => {
    const partial: SummaryExport = { ...exported, summaries: exported.summaries.filter((s) => s.key !== "SHOP-3") };
    const r = await reseed(partial);
    expect(r.missing).toEqual(["SHOP-3"]);
    expect(r.seeded).toBe(22);
  });

  it("rejects malformed summary entries", async () => {
    const broken: SummaryExport = JSON.parse(JSON.stringify(exported));
    broken.summaries.find((s) => s.key === "SHOP-4")!.json = { not: "a summary" };
    const r = await reseed(broken);
    expect(r.invalid).toEqual(["SHOP-4"]);
  });
});

describe("seedIfEmpty", () => {
  it("seeds an empty database", async () => {
    await wipeProject(prisma, "SHOP");
    await prisma.ticket.deleteMany();
    const r = await seedIfEmpty({ db: prisma, encryptionKey: key, summaries: exported });
    expect(r?.seeded).toBe(23);
  });
  it("does nothing when data already exists, so a restart never overwrites anything", async () => {
    const before = await prisma.summary.count();
    expect(await seedIfEmpty({ db: prisma, encryptionKey: key, summaries: exported })).toBeNull();
    expect(await prisma.summary.count()).toBe(before);
  });
});
