import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, wipeProject } from "@kairo/db";
import { FixtureConnector } from "@kairo/connectors";
import { ingestProject } from "@kairo/ingest";
import type { Rule } from "@kairo/policy";
import { summarizeStoredTicket } from "./job";
import type { LlmProvider } from "./provider";
import { HeuristicProvider } from "./providers/heuristic";
import { buildTsQuery, extractKeys, isOverviewQuestion, overviewTickets, searchTickets, summaryToSearchText } from "./search";
import { hnd1Summary } from "./testdata";

describe("buildTsQuery", () => {
  it("builds an OR query of prefix terms", () => expect(buildTsQuery("redis cache")).toBe("redis:* | cache:*"));
  it("drops stop words and short tokens", () => expect(buildTsQuery("why did we reject the redis cache?")).toBe("reject:* | redis:* | cache:*"));
  it("returns null when nothing searchable is left", () => {
    expect(buildTsQuery("what is the")).toBeNull();
    expect(buildTsQuery("   ")).toBeNull();
    expect(buildTsQuery("?!&|:*()")).toBeNull();
  });
  it("strips tsquery operators and quotes so input cannot change the query structure", () => {
    const q = buildTsQuery(`'; DROP TABLE "Summary"; -- & | ! ( ) :* <->`)!;
    expect(q).toMatch(/^[a-z0-9:* |]+$/);
    expect(q).not.toMatch(/[&!()<>'"]/);
  });
  it("lowercases, dedupes and caps the number of terms", () => {
    expect(buildTsQuery("Redis REDIS redis")).toBe("redis:*");
    expect(buildTsQuery(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "))!.split(" | ")).toHaveLength(12);
  });
  it("ignores ticket keys (they are looked up directly)", () => expect(buildTsQuery("tell me about HND-4 login")).toBe("tell:* | login:*"));
});

describe("extractKeys", () => {
  it("finds ticket keys case-insensitively, uppercased and deduped", () => expect(extractKeys("compare hnd-1 and HND-1 with Proj2-45")).toEqual(["HND-1", "PROJ2-45"]));
  it("finds none in ordinary text", () => expect(extractKeys("nothing here, version 1-2")).toEqual([]));
});

describe("summaryToSearchText", () => {
  it("includes key, title, labels and every summary field", () => {
    const t = summaryToSearchText({ key: "HND-1", title: "Checkout times out", labels: ["backend"] }, hnd1Summary());
    for (const s of ["HND-1", "Checkout times out", "backend", "N+1 queries", "Batched the lookup", "Redis cache", "Cache invalidation", "1000 ids", "Dana Kim", "HND-4"]) expect(t).toContain(s);
  });
});

// ---------- database-backed retrieval ----------
const rules: Rule[] = [
  { label: null, visibility: "readable" },
  { label: "hr-confidential", visibility: "restricted" },
];

/** Rich summary for HND-1, garbage for HND-8 (so it is rejected), offline heuristic for the rest. */
const provider: LlmProvider = {
  name: "scripted",
  model: "scripted-1",
  async generate(req) {
    if (req.ticketKey === "HND-1") return { json: hnd1Summary() };
    if (req.ticketKey === "HND-8") return { json: { nope: true } };
    return new HeuristicProvider().generate(req);
  },
};

beforeAll(async () => {
  await wipeProject(prisma, "HND");
  const conn = await prisma.connection.create({ data: { baseUrl: "fixtures" } });
  await prisma.project.create({ data: { key: "HND", name: "Kairo Demo", connectionId: conn.id, enabled: true } });
  await ingestProject({ connector: new FixtureConnector(), db: prisma, projectKey: "HND", rules, encryptionKey: randomBytes(32).toString("base64"), enqueueSummarize: async () => {} });
  for (const k of ["HND-1", "HND-2", "HND-3", "HND-4", "HND-5", "HND-7", "HND-8", "HND-9", "HND-10"]) await summarizeStoredTicket({ db: prisma, provider, ticketKey: k });
});
afterAll(async () => {
  await wipeProject(prisma, "HND");
  await prisma.$disconnect();
});

const keysOf = async (q: string, limit?: number) => (await searchTickets(prisma, q, { limit })).map((h) => h.key);

describe("searchTickets", () => {
  it("finds a ticket by the content of its summary, best match first", async () => {
    const hits = await searchTickets(prisma, "why did we reject the redis cache?");
    expect(hits[0]!.key).toBe("HND-1");
    expect(hits[0]).toMatchObject({ title: "Checkout times out under load", url: "https://fake.atlassian.net/browse/HND-1" });
    expect(hits[0]!.summary.rejected_options[0]!.option).toBe("Redis cache");
    expect(hits[0]!.sourceText).toContain("Redis cache");
  });

  it("matches word forms (stemming and prefixes)", async () => {
    expect(await keysOf("login loops after refreshing")).toContain("HND-5");
  });

  it("finds tickets by their title and by heuristic problem text", async () => {
    expect(await keysOf("nightly report duplicate rows")).toContain("HND-7");
  });

  it("looks up tickets named by key, even without any text match", async () => {
    const keys = await keysOf("what do you know about HND-4?");
    expect(keys[0]).toBe("HND-4");
  });

  it("returns nothing for unrelated questions and for stop-word-only questions", async () => {
    expect(await keysOf("kubernetes terraform helm")).toEqual([]);
    expect(await keysOf("what is the")).toEqual([]);
  });

  it("NEVER returns restricted tickets, whether searched by content or by key", async () => {
    expect(await keysOf("salary band compensation level 5")).not.toContain("HND-6");
    expect(await keysOf("show me HND-6")).not.toContain("HND-6");
    expect(await keysOf("restricted")).not.toContain("HND-6");
  });

  it("does not return tickets whose summary was rejected", async () => {
    expect(await keysOf("upgrade node 16")).not.toContain("HND-8");
    expect(await keysOf("HND-8")).not.toContain("HND-8");
  });

  it("respects the limit", async () => {
    expect((await searchTickets(prisma, "checkout login report webhook session", { limit: 2 })).length).toBeLessThanOrEqual(2);
  });

  it("is safe against SQL and tsquery injection", async () => {
    const before = await prisma.summary.count();
    // Words like "table" may legitimately match; what matters is that it runs as a plain search and nothing is dropped.
    await expect(keysOf(`'; DROP TABLE "Summary"; --`)).resolves.toBeInstanceOf(Array);
    expect(await keysOf("redis & ! ( | ) :* <->")).toContain("HND-1");
    expect(await prisma.summary.count()).toBe(before);
  });

  it("returns redacted source text only", async () => {
    const hits = await searchTickets(prisma, "stripe webhook leaks key");
    const h = hits.find((x) => x.key === "HND-2")!;
    expect(h.sourceText).toContain("[REDACTED:api_key]");
    expect(h.sourceText).not.toContain("sk_live_");
    expect(h.sourceText).not.toContain("Sup3rS3cret");
  });
});

describe("isOverviewQuestion", () => {
  it.each(["what did we do?", "what we did", "summarize the project", "tell me everything", "give me an overview", "catch me up on what happened", "what has the team done so far?"])("treats %j as a broad question", (q) => {
    expect(isOverviewQuestion(q)).toBe(true);
  });
  it.each(["what have we done on payments", "what did we do about search", "what happened during Black Friday", "who worked on login", "why did we reject the redis cache", "tell me about HND-4", "hello"])("treats %j as a topic question", (q) => {
    expect(isOverviewQuestion(q)).toBe(false);
  });
  it("does not treat punctuation-only input as a question", () => {
    expect(isOverviewQuestion("???")).toBe(false);
    expect(isOverviewQuestion("   ")).toBe(false);
  });
});

describe("overviewTickets", () => {
  it("returns epics first, then the most recently updated readable tickets with verified summaries", async () => {
    const hits = await overviewTickets(prisma, { limit: 6 });
    const keys = hits.map((h) => h.key);
    expect(keys.slice(0, 2).sort()).toEqual(["HND-10", "HND-9"]);
    expect(hits.length).toBeLessThanOrEqual(6);
    expect(hits[0]!.sourceText.length).toBeGreaterThan(0);
  });
  it("never includes restricted tickets or tickets whose summary was rejected", async () => {
    const keys = (await overviewTickets(prisma, { limit: 50 })).map((h) => h.key);
    expect(keys).not.toContain("HND-6");
    expect(keys).not.toContain("HND-8");
  });
  it("respects the limit and returns redacted text only", async () => {
    expect(await overviewTickets(prisma, { limit: 2 })).toHaveLength(2);
    const all = (await overviewTickets(prisma, { limit: 50 })).map((h) => h.sourceText).join("\n");
    expect(all).not.toContain("sk_live_");
    expect(all).not.toContain("Sup3rS3cret");
  });
});

describe("overviewTickets covers every theme", () => {
  it("includes at least one child ticket of each epic, so every theme has real substance", async () => {
    const keys = (await overviewTickets(prisma, { limit: 6 })).map((h) => h.key);
    expect(keys).toEqual(expect.arrayContaining(["HND-9", "HND-10"]));
    expect(keys.some((k) => ["HND-1", "HND-2"].includes(k))).toBe(true); // children of HND-9
    expect(keys.some((k) => ["HND-3", "HND-5"].includes(k))).toBe(true); // children of HND-10
  });
  it("still fills up with recent tickets when the epics have few children", async () => {
    expect((await overviewTickets(prisma, { limit: 8 })).length).toBe(8);
  });
  it("has no duplicates", async () => {
    const keys = (await overviewTickets(prisma, { limit: 50 })).map((h) => h.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("overviewTickets with a tight limit", () => {
  it("spends a small budget on epics plus one child each, not on unrelated recent tickets", async () => {
    const keys = (await overviewTickets(prisma, { limit: 4 })).map((h) => h.key).sort();
    expect(keys).toHaveLength(4);
    expect(keys).toEqual(expect.arrayContaining(["HND-10", "HND-9"]));
    expect(keys.filter((k) => ["HND-1", "HND-2"].includes(k))).toHaveLength(1); // exactly one child of HND-9
    expect(keys.filter((k) => ["HND-3", "HND-5"].includes(k))).toHaveLength(1); // exactly one child of HND-10
  });
});

describe("isOverviewQuestion: other ways of asking broadly", () => {
  it.each([
    "conclude what are we doing",
    "give me a recap",
    "wrap up what the team has accomplished",
    "what's the current status?",
    "how is it going",
    "sum up the work",
    "give me the highlights",
    "what is going on",
    "explain the project to me",
    "describe what we built",
    "what have we achieved so far",
    "list everything we shipped",
    "progress update please",
    "where are we at",
  ])("recognizes %j as broad", (q) => expect(isOverviewQuestion(q)).toBe(true));

  it.each([
    "explain the idempotency key",
    "describe the refund bug",
    "what was built for search",
    "status of the payments epic",
    "update on the apple pay launch",
    "recap the black friday incident",
    "what did we accomplish on login",
  ])("still treats %j as a question about a topic", (q) => expect(isOverviewQuestion(q)).toBe(false));
});
