import { describe, expect, it, vi } from "vitest";
import { InvalidJsonError, ProviderRefusalError, type LlmRequest } from "../provider";
import { OpenAiProvider } from "./openai";
import { AnthropicProvider, type AnthropicLike } from "./anthropic";
import { HeuristicProvider } from "./heuristic";
import { createProvider } from "./index";
import { validateSummary } from "../schema";
import { verifyEvidence } from "../verify";
import { renderTicketText, NormalizedTicket } from "@handover/core";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const schema = { type: "object", properties: {}, required: [] };
const req: LlmRequest = { system: "SYS", user: "USER", schema, ticketKey: "HND-1", ticketText: "x" };
const KEY = "sk-test-supersecretkey1234567890";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAiProvider", () => {
  const ok = (content: unknown) => json(200, { choices: [{ message: { content: JSON.stringify(content) } }] });

  it("requires an API key and a model", () => {
    expect(() => new OpenAiProvider({ apiKey: "", model: "m" })).toThrow(/OPENAI_API_KEY/);
    expect(() => new OpenAiProvider({ apiKey: KEY, model: "" })).toThrow(/OPENAI_MODEL/);
  });

  it("sends a strict json_schema chat completion with bearer auth", async () => {
    const f = vi.fn(async () => ok({ a: 1 }));
    const p = new OpenAiProvider({ apiKey: KEY, model: "my-model", fetch: f as unknown as typeof fetch });
    const out = await p.generate(req);
    expect(out.json).toEqual({ a: 1 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("my-model");
    expect(body.messages).toEqual([{ role: "system", content: "SYS" }, { role: "user", content: "USER" }]);
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true, schema } });
  });

  it("supports OpenAI-compatible base URLs (Gemini, Groq, Ollama...)", async () => {
    const f = vi.fn(async () => ok({}));
    await new OpenAiProvider({ apiKey: KEY, model: "m", baseUrl: "http://localhost:11434/v1/", fetch: f as unknown as typeof fetch }).generate(req);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("http://localhost:11434/v1/chat/completions");
  });

  it("throws InvalidJsonError when the content is not JSON", async () => {
    const f = async () => json(200, { choices: [{ message: { content: "sorry, here is prose" } }] });
    await expect(new OpenAiProvider({ apiKey: KEY, model: "m", fetch: f as unknown as typeof fetch }).generate(req)).rejects.toBeInstanceOf(InvalidJsonError);
  });

  it("throws ProviderRefusalError on a model refusal", async () => {
    const f = async () => json(200, { choices: [{ message: { content: null, refusal: "I can't help with that" } }] });
    await expect(new OpenAiProvider({ apiKey: KEY, model: "m", fetch: f as unknown as typeof fetch }).generate(req)).rejects.toBeInstanceOf(ProviderRefusalError);
  });

  it("never puts the API key in error messages", async () => {
    const f = async () => json(401, { error: { message: `Incorrect API key provided: ${KEY}`, code: "invalid_api_key" } });
    const err = await new OpenAiProvider({ apiKey: KEY, model: "m", fetch: f as unknown as typeof fetch }).generate(req).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toContain(KEY);
    expect((err as Error).message).not.toContain("sk-test");
  });
});

describe("AnthropicProvider", () => {
  const fakeClient = (resp: unknown) => {
    const create = vi.fn(async () => resp);
    return { create, client: { messages: { create } } as unknown as AnthropicLike };
  };
  const text = (t: string, extra = {}) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn", ...extra });

  it("requires a model", () => expect(() => new AnthropicProvider({ model: "", client: fakeClient({}).client })).toThrow(/ANTHROPIC_MODEL/));

  it("uses structured output via output_config.format and no forced tool_choice", async () => {
    const { create, client } = fakeClient(text('{"a":1}'));
    const out = await new AnthropicProvider({ model: "claude-opus-5-5", client }).generate(req);
    expect(out.json).toEqual({ a: 1 });
    const params = (create.mock.calls[0] as unknown as [Record<string, any>])[0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.system).toBe("SYS");
    expect(params.messages).toEqual([{ role: "user", content: "USER" }]);
    expect(params.output_config.format).toMatchObject({ type: "json_schema", schema });
    expect(params.tool_choice).toBeUndefined();
    expect(params.temperature).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(params.max_tokens).toBeGreaterThanOrEqual(8000);
  });

  it("throws ProviderRefusalError on stop_reason refusal", async () => {
    const { client } = fakeClient({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" } });
    await expect(new AnthropicProvider({ model: "m", client }).generate(req)).rejects.toBeInstanceOf(ProviderRefusalError);
  });

  it("throws InvalidJsonError on non-JSON text and on max_tokens truncation", async () => {
    await expect(new AnthropicProvider({ model: "m", client: fakeClient(text("prose")).client }).generate(req)).rejects.toBeInstanceOf(InvalidJsonError);
    await expect(new AnthropicProvider({ model: "m", client: fakeClient(text('{"a":', { stop_reason: "max_tokens" })).client }).generate(req)).rejects.toBeInstanceOf(InvalidJsonError);
  });
});

describe("HeuristicProvider (offline, no-key provider)", () => {
  const dir = join(__dirname, "../../../../fixtures/jira");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it.each(files)("%s: produces a schema-valid summary whose evidence verifies", async (f) => {
    const t = NormalizedTicket.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    const text = renderTicketText(t);
    const out = await new HeuristicProvider().generate({ ...req, ticketKey: t.key, ticketText: text });
    const v = validateSummary(out.json, t.key);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    if (v.ok) expect(verifyEvidence(v.summary, text).ok).toBe(true);
  });
});

describe("createProvider", () => {
  it("defaults to the offline heuristic provider", () => expect(createProvider({}).name).toBe("heuristic"));
  it("builds openai and anthropic from env", () => {
    expect(createProvider({ LLM_PROVIDER: "openai", OPENAI_API_KEY: KEY, OPENAI_MODEL: "m" }).name).toBe("openai");
    expect(createProvider({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "claude-opus-5-5" }).name).toBe("anthropic");
  });
  it("accepts mock as an alias for the heuristic provider", () => expect(createProvider({ LLM_PROVIDER: "mock" }).name).toBe("heuristic"));
  it("fails loudly on unknown providers or missing config", () => {
    expect(() => createProvider({ LLM_PROVIDER: "nope" })).toThrow(/LLM_PROVIDER/);
    expect(() => createProvider({ LLM_PROVIDER: "openai" })).toThrow(/OPENAI_API_KEY/);
  });
});
