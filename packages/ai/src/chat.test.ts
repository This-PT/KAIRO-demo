import { describe, expect, it } from "vitest";
import { buildChatPrompt, MAX_SOURCE_CHARS } from "./chat-prompt";
import { chatJsonSchema, validateChatAnswer, verifyCitations } from "./chat-verify";
import { answerFromSources, type ChatAudit } from "./chat";
import { InvalidJsonError, type LlmProvider, type LlmRequest } from "./provider";
import { HeuristicProvider } from "./providers/heuristic";
import type { SearchHit } from "./search";
import { hnd1Summary } from "./testdata";

const A_TEXT = "[HND-1] Checkout times out\nDescription:\nCheckout API returns 504 when more than 200 concurrent users hit it.\nComments:\n- Dana Kim (c): Fixed by batching the lookup with a single IN query. I considered adding a Redis cache but we rejected it because cache invalidation on price changes is risky.";
const B_TEXT = "[HND-3] Migrate sessions\nDescription:\nMove sessions to JWTs.\nComments:\n- Mia Torres (c): We rejected long-lived JWTs since they cannot be revoked.";
const hit = (key: string, sourceText: string): SearchHit => ({ key, title: `Title ${key}`, url: `https://x/browse/${key}`, summary: { ...hnd1Summary(), ticket: key }, confidence: "high", sourceText });
const hits = [hit("HND-1", A_TEXT), hit("HND-3", B_TEXT)];

const answer = (o: Partial<{ answer: string; citations: { ticket: string; quote: string }[]; confidence: string; not_found: boolean }> = {}) => ({
  answer: "The Redis cache was rejected because cache invalidation on price changes is risky [HND-1].",
  citations: [{ ticket: "HND-1", quote: "we rejected it because cache invalidation on price changes is risky" }],
  confidence: "high",
  not_found: false,
  ...o,
});

function scripted(responses: (unknown | Error)[]) {
  const calls: LlmRequest[] = [];
  const provider: LlmProvider = {
    name: "test",
    model: "m",
    async generate(req) {
      calls.push(req);
      const r = responses[Math.min(calls.length - 1, responses.length - 1)];
      if (r instanceof Error) throw r;
      return { json: r };
    },
  };
  return { provider, calls };
}

describe("chatJsonSchema", () => {
  it("is a strict object with every property required and no $ref", () => {
    const s = chatJsonSchema as Record<string, any>;
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(["answer", "citations", "confidence", "not_found"]);
    expect(JSON.stringify(s)).not.toContain("$ref");
  });
});

describe("validateChatAnswer", () => {
  const keys = new Set(["HND-1", "HND-3"]);
  it("accepts a well-formed answer", () => expect(validateChatAnswer(answer(), keys).ok).toBe(true));
  it("rejects wrong shapes and extra properties", () => {
    expect(validateChatAnswer({ ...answer(), extra: 1 }, keys).ok).toBe(false);
    expect(validateChatAnswer({ ...answer(), confidence: "sure" }, keys).ok).toBe(false);
    expect(validateChatAnswer("text", keys).ok).toBe(false);
  });
  it("requires at least one citation for a found answer", () => {
    const r = validateChatAnswer(answer({ citations: [] }), keys);
    expect(!r.ok && r.errors.join()).toMatch(/citation/i);
  });
  it("requires not_found answers to have no citations", () => {
    expect(validateChatAnswer(answer({ not_found: true, citations: [] }), keys).ok).toBe(true);
    expect(validateChatAnswer(answer({ not_found: true }), keys).ok).toBe(false);
  });
  it("rejects citations to tickets that were not provided", () => {
    const r = validateChatAnswer(answer({ citations: [{ ticket: "HND-99", quote: "whatever quote here" }] }), keys);
    expect(!r.ok && r.errors.join()).toMatch(/HND-99/);
  });
  it("rejects answers that mention ticket keys that were not provided", () => {
    const r = validateChatAnswer(answer({ answer: "See HND-77 for details [HND-1]." }), keys);
    expect(!r.ok && r.errors.join()).toMatch(/HND-77/);
  });
  it("rejects an empty answer", () => expect(validateChatAnswer(answer({ answer: "  " }), keys).ok).toBe(false));
});

describe("verifyCitations", () => {
  const sources = new Map([["HND-1", A_TEXT], ["HND-3", B_TEXT]]);
  it("accepts verbatim quotes, ignoring case, whitespace and curly quotes", () => {
    const r = verifyCitations([{ ticket: "HND-1", quote: "  WE rejected it because\n cache invalidation on price changes is risky" }], sources);
    expect(r.bad).toEqual([]);
  });
  it("rejects paraphrases", () => {
    expect(verifyCitations([{ ticket: "HND-1", quote: "They decided against caching to avoid stale prices" }], sources).bad).toHaveLength(1);
  });
  it("rejects a real quote attributed to the wrong ticket", () => {
    expect(verifyCitations([{ ticket: "HND-3", quote: "we rejected it because cache invalidation on price changes is risky" }], sources).bad).toHaveLength(1);
  });
  it("rejects empty or very short quotes", () => {
    expect(verifyCitations([{ ticket: "HND-1", quote: "" }, { ticket: "HND-1", quote: "504" }], sources).bad).toHaveLength(2);
  });
});

describe("buildChatPrompt", () => {
  const base = { question: "Why was Redis rejected?", hits, nonce: "n0nce", history: [] as { role: "user" | "assistant"; content: string }[] };
  it("treats ticket text as untrusted data inside nonce delimiters, separate from the question", () => {
    const p = buildChatPrompt(base);
    expect(p.system).toMatch(/untrusted/i);
    expect(p.system).toMatch(/never follow/i);
    expect(p.user).toContain("BEGIN SOURCES n0nce");
    expect(p.user).toContain("END SOURCES n0nce");
    expect(p.user.indexOf("Why was Redis rejected?")).toBeGreaterThan(p.user.indexOf("END SOURCES n0nce"));
  });
  it("states the rules: only the sources, cite verbatim, say when not found", () => {
    const { system } = buildChatPrompt(base);
    for (const re of [/only the sources/i, /verbatim/i, /not_found/i, /never invent/i]) expect(system).toMatch(re);
  });
  it("includes every source with its key, title and original text", () => {
    const { user } = buildChatPrompt(base);
    for (const s of ["[HND-1]", "Title HND-1", "Redis cache", "[HND-3]", "long-lived JWTs"]) expect(user).toContain(s);
  });
  it("truncates long sources and reports the exact text sent", () => {
    const long = hit("HND-1", "x".repeat(MAX_SOURCE_CHARS * 2));
    const p = buildChatPrompt({ ...base, hits: [long] });
    expect(p.sentText.get("HND-1")!.length).toBeLessThanOrEqual(MAX_SOURCE_CHARS);
    expect(p.user.length).toBeLessThan(MAX_SOURCE_CHARS + 4000);
  });
  it("includes recent history and retry feedback only when given", () => {
    expect(buildChatPrompt(base).user).not.toMatch(/previous answer|conversation so far/i);
    const p = buildChatPrompt({ ...base, history: [{ role: "user", content: "Earlier question" }, { role: "assistant", content: "Earlier answer" }], feedback: ["quote not found"] });
    expect(p.user).toContain("Earlier question");
    expect(p.user).toContain("quote not found");
  });
});

describe("answerFromSources", () => {
  const run = (provider: LlmProvider, extra: Partial<Parameters<typeof answerFromSources>[0]> = {}) =>
    answerFromSources({ provider, question: "Why was Redis rejected?", history: [], hits, ...extra });

  it("returns a verified answer with enriched citations", async () => {
    const { provider } = scripted([answer()]);
    const r = await run(provider);
    expect(r).toMatchObject({ status: "answered", attempts: 1, confidence: "high" });
    expect(r.citations).toEqual([{ ticket: "HND-1", quote: "we rejected it because cache invalidation on price changes is risky", title: "Title HND-1", url: "https://x/browse/HND-1" }]);
    expect(r.sources.map((s) => s.key)).toEqual(["HND-1", "HND-3"]);
  });

  it("does not call the model when nothing relevant was found", async () => {
    const { provider, calls } = scripted([answer()]);
    const r = await run(provider, { hits: [] });
    expect(r.status).toBe("no_sources");
    expect(r.answer).toMatch(/couldn't find|could not find/i);
    expect(calls).toHaveLength(0);
  });

  it("retries once with feedback when a quote is not in the source", async () => {
    const bad = answer({ citations: [{ ticket: "HND-1", quote: "they chose not to cache because of stale prices" }] });
    const { provider, calls } = scripted([bad, answer()]);
    const r = await run(provider);
    expect(r).toMatchObject({ status: "answered", attempts: 2 });
    expect(calls[1]!.user).toMatch(/previous answer/i);
  });

  it("keeps the valid citations and lowers confidence when only some quotes fail twice", async () => {
    const mixed = answer({ citations: [{ ticket: "HND-1", quote: "we rejected it because cache invalidation on price changes is risky" }, { ticket: "HND-3", quote: "an invented sentence that is not there" }] });
    const { provider } = scripted([mixed]);
    const r = await run(provider);
    expect(r.status).toBe("answered");
    expect(r.citations.map((c) => c.ticket)).toEqual(["HND-1"]);
    expect(r.confidence).toBe("medium");
  });

  it("never returns the model's unverified text when no citation survives", async () => {
    const bad = answer({ answer: "SECRET INVENTED CLAIM [HND-1]", citations: [{ ticket: "HND-1", quote: "completely made up quote text" }] });
    const { provider, calls } = scripted([bad]);
    const r = await run(provider);
    expect(r.status).toBe("rejected");
    expect(r.answer).not.toContain("INVENTED");
    expect(r.citations).toEqual([]);
    expect(r.sources.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(2);
  });

  it("passes through a not_found answer without citations", async () => {
    const { provider } = scripted([answer({ not_found: true, citations: [], answer: "The tickets do not say.", confidence: "low" })]);
    const r = await run(provider);
    expect(r).toMatchObject({ status: "not_found", answer: "The tickets do not say.", citations: [] });
  });

  it("rejects answers that invent ticket keys", async () => {
    const { provider } = scripted([answer({ answer: "As HND-42 shows, caching is bad [HND-1]." })]);
    expect((await run(provider)).status).toBe("rejected");
  });

  it("retries on invalid JSON and propagates provider errors", async () => {
    expect((await run(scripted([new InvalidJsonError("x"), answer()]).provider)).status).toBe("answered");
    await expect(run(scripted([new Error("boom")]).provider)).rejects.toThrow("boom");
  });

  it("verifies quotes against the text actually sent, so quotes from truncated-off text fail", async () => {
    const tail = "THE-SECRET-TAIL-SENTENCE-NEVER-SENT-TO-THE-MODEL";
    const long = hit("HND-1", "x ".repeat(MAX_SOURCE_CHARS) + tail);
    const { provider } = scripted([answer({ citations: [{ ticket: "HND-1", quote: tail }] })]);
    expect((await run(provider, { hits: [long] })).status).toBe("rejected");
  });

  it("never sends secrets typed into the question to the model", async () => {
    const { provider, calls } = scripted([answer()]);
    await run(provider, { question: "Why was it rejected? my password=Hunter2hunter and mail a@b.com" });
    expect(calls[0]!.user).not.toContain("Hunter2hunter");
    expect(calls[0]!.user).not.toContain("a@b.com");
    expect(calls[0]!.user).toContain("[REDACTED:password]");
  });

  it("audits every attempt before it is sent, listing exactly the tickets included", async () => {
    const events: string[] = [];
    const payloads: string[] = [];
    const audit: ChatAudit = {
      async record(e) {
        events.push(`record:${e.ticketKeys.join(",")}`);
        payloads.push(e.payload);
        return `id${events.length}`;
      },
      async finish(id, outcome) {
        events.push(`finish:${id}:${outcome}`);
      },
    };
    const order: string[] = [];
    const provider: LlmProvider = { name: "t", model: "m", async generate() { order.push(events.join("|")); return { json: answer() }; } };
    await run(provider, { audit });
    expect(order).toEqual(["record:HND-1,HND-3"]);
    expect(events).toEqual(["record:HND-1,HND-3", "finish:id1:answered"]);
    expect(payloads[0]).toContain("Redis cache");
  });

  it("marks the audit entry as error when the provider throws", async () => {
    const events: string[] = [];
    const audit: ChatAudit = { async record() { return "x"; }, async finish(_id, o) { events.push(o); } };
    await run(scripted([new Error("down")]).provider, { audit }).catch(() => {});
    expect(events).toEqual(["error"]);
  });
});

describe("HeuristicProvider (offline chat)", () => {
  it("returns a verifiable, low-confidence answer quoting the top source", async () => {
    const p = new HeuristicProvider();
    const req: LlmRequest = { system: "", user: "", schema: chatJsonSchema, ticketKey: "", ticketText: "", chat: { question: "checkout", sources: hits.map((h) => ({ key: h.key, text: h.sourceText })) } };
    const r = await answerFromSources({ provider: p, question: "checkout", history: [], hits });
    expect(r.status).toBe("answered");
    expect(r.confidence).toBe("low");
    expect(r.citations[0]!.ticket).toBe("HND-1");
    void req;
  });
  it("says not found when there are no sources", async () => {
    const out = (await new HeuristicProvider().generate({ system: "", user: "", schema: {}, ticketKey: "", ticketText: "", chat: { question: "x", sources: [] } })).json as { not_found: boolean };
    expect(out.not_found).toBe(true);
  });
});

describe("broad questions and partial answers", () => {
  const base = { question: "What did we do?", hits, nonce: "n0nce", history: [] as { role: "user" | "assistant"; content: string }[] };
  it("tells the model that an overview is a sample and to summarize by theme instead of refusing", () => {
    const { system } = buildChatPrompt({ ...base, scope: "overview" });
    expect(system).toMatch(/sample/i);
    expect(system).toMatch(/theme/i);
    expect(system).toMatch(/not set not_found|do not refuse|not_found just because/i);
  });
  it("does not mention the overview sample for normal searches", () => {
    expect(buildChatPrompt({ ...base, scope: "search" }).system).not.toMatch(/overview sample/i);
    expect(buildChatPrompt(base).system).not.toMatch(/overview sample/i);
  });
  it("tells the model to answer the part it can instead of refusing the whole question", () => {
    expect(buildChatPrompt(base).system).toMatch(/only part|partly|part of the question/i);
  });
  it("reports the scope in the result", async () => {
    const { provider } = scripted([answer()]);
    expect((await answerFromSources({ provider, question: "Why was Redis rejected?", history: [], hits, scope: "overview" })).scope).toBe("overview");
    expect((await answerFromSources({ provider: scripted([answer()]).provider, question: "Why was Redis rejected?", history: [], hits })).scope).toBe("search");
  });
  it("gives a helpful hint when nothing is found", async () => {
    const r = await answerFromSources({ provider: scripted([answer()]).provider, question: "kubernetes", history: [], hits: [] });
    expect(r.answer).toMatch(/couldn't find/i);
    expect(r.answer).toMatch(/topic|person|ticket key/i);
  });
});
