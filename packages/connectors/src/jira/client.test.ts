import { describe, expect, it, vi } from "vitest";
import { JiraClient } from "./client";

const res = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const mk = (fetchFn: typeof fetch, extra = {}) => {
  const sleeps: number[] = [];
  const client = new JiraClient({
    baseUrl: "https://x.atlassian.net/",
    email: "a@b.c",
    apiToken: "tok",
    fetch: fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    ...extra,
  });
  return { client, sleeps };
};

describe("JiraClient", () => {
  it("sends Basic auth and builds the URL from base + path + params", async () => {
    const f = vi.fn(async () => res(200, { ok: 1 }));
    const { client } = mk(f as unknown as typeof fetch);
    await client.get("/rest/api/3/search/jql", { jql: "project = X", maxResults: 100 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.atlassian.net/rest/api/3/search/jql?jql=project+%3D+X&maxResults=100");
    expect((init.headers as Record<string, string>).Authorization).toBe("Basic " + Buffer.from("a@b.c:tok").toString("base64"));
  });
  it("retries on 429 honouring Retry-After (seconds)", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429, {}, { "retry-after": "3" })).mockResolvedValueOnce(res(200, { ok: 1 }));
    const { client, sleeps } = mk(f as unknown as typeof fetch);
    expect(await client.get("/x")).toEqual({ ok: 1 });
    expect(sleeps).toEqual([3000]);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("uses exponential backoff on 503 without Retry-After", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200, { ok: 1 }));
    const { client, sleeps } = mk(f as unknown as typeof fetch);
    await client.get("/x");
    expect(sleeps).toEqual([1000, 2000]);
  });
  it("gives up after maxRetries", async () => {
    const f = vi.fn(async () => res(429));
    const { client } = mk(f as unknown as typeof fetch, { maxRetries: 2 });
    await expect(client.get("/x")).rejects.toThrow(/429/);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("does not retry on 401 and never leaks the token in the error", async () => {
    const f = vi.fn(async () => res(401, { message: "no" }));
    const { client } = mk(f as unknown as typeof fetch);
    const err = await client.get("/x").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/401/);
    expect((err as Error).message).not.toContain("tok");
    expect(f).toHaveBeenCalledTimes(1);
  });
});
