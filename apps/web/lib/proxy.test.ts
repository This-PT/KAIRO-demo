import { describe, expect, it, vi } from "vitest";
import { handleProxy } from "./proxy";

const TOKEN = "super-secret-admin-token";
const API = "http://127.0.0.1:4000";

const setup = (resp: Response | Error = new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } })) => {
  const fetchFn = vi.fn(async () => {
    if (resp instanceof Error) throw resp;
    return resp.clone();
  });
  const run = (method: string, segments: string[], init: { headers?: Record<string, string>; body?: string; search?: string } = {}) =>
    handleProxy({
      request: new Request(`http://localhost:3000/api/proxy/${segments.join("/")}${init.search ?? ""}`, { method, headers: init.headers, body: init.body }),
      segments,
      apiUrl: API,
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
  return { fetchFn, run };
};
const csrf = { "x-requested-with": "kairo", origin: "http://localhost:3000", "content-type": "application/json" };

describe("handleProxy", () => {
  it("forwards GETs with the server-side token and the query string", async () => {
    const { fetchFn, run } = setup();
    const res = await run("GET", ["tickets"], { search: "?q=checkout&limit=5" });
    expect(res.status).toBe(200);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API}/api/tickets?q=checkout&limit=5`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("exposes the chat API (questions and saved conversations)", async () => {
    const { run } = setup();
    expect((await run("POST", ["chat"], { headers: csrf, body: '{"message":"hi there"}' })).status).toBe(200);
    expect((await run("GET", ["chat", "sessions", "abc123"])).status).toBe(200);
  });

  it("forwards the visitor id set by the middleware, and nothing malformed", async () => {
    const good = "c".repeat(32);
    for (const [value, expected] of [[good, good], ["not-valid", undefined], ["../x", undefined]] as const) {
      const { fetchFn, run } = setup();
      await run("GET", ["chat", "sessions"], { headers: { "x-visitor-id": value } });
      const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
      expect((init.headers as Record<string, string>)["x-visitor-id"]).toBe(expected);
    }
    const { fetchFn, run } = setup();
    await run("GET", ["chat", "sessions"]);
    expect(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["x-visitor-id"]).toBeUndefined();
  });

  it("accepts same-site writes when the server only sees an internal URL, using the public host header", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const res = await handleProxy({
      request: new Request("http://0.0.0.0:10000/api/proxy/chat", {
        method: "POST",
        headers: { "x-requested-with": "kairo", origin: "https://demo.onrender.com", "x-forwarded-host": "demo.onrender.com", "content-type": "application/json" },
        body: "{}",
      }),
      segments: ["chat"],
      apiUrl: API,
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(res.status).toBe(200);
    const blocked = await handleProxy({
      request: new Request("http://0.0.0.0:10000/api/proxy/chat", { method: "POST", headers: { "x-requested-with": "kairo", origin: "https://evil.example", "x-forwarded-host": "demo.onrender.com" }, body: "{}" }),
      segments: ["chat"],
      apiUrl: API,
      token: TOKEN,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(blocked.status).toBe(403);
  });

  it("accepts a real browser's same-origin write (Origin: null + Sec-Fetch-Site: same-origin) but not a cross-site one", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const run = (site: string) =>
      handleProxy({
        request: new Request("http://0.0.0.0:10000/api/proxy/chat", { method: "POST", headers: { "x-requested-with": "kairo", origin: "null", "sec-fetch-site": site, "content-type": "application/json" }, body: "{}" }),
        segments: ["chat"],
        apiUrl: API,
        token: TOKEN,
        fetchFn: fetchFn as unknown as typeof fetch,
      });
    expect((await run("same-origin")).status).toBe(200);
    expect((await run("cross-site")).status).toBe(403);
  });

  it("does not require the CSRF header for GET", async () => expect((await setup().run("GET", ["projects"])).status).toBe(200));

  it.each([[".."], ["."], ["a/b"], ["%2e%2e"], [""], ["a b"], ["a\\b"]])("rejects the path segment %j", async (seg) => {
    const { fetchFn, run } = setup();
    expect((await run("GET", ["tickets", seg])).status).toBe(400);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([["health"], ["admin"], ["internal"]])("only exposes known API areas, not /%s", async (first) => {
    const { fetchFn, run } = setup();
    expect((await run("GET", [first])).status).toBe(404);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks writes without the CSRF header", async () => {
    const { fetchFn, run } = setup();
    expect((await run("POST", ["projects", "HND", "ingest"], { headers: { origin: "http://localhost:3000" } })).status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks cross-origin writes even with the header", async () => {
    const { fetchFn, run } = setup();
    const res = await run("PATCH", ["projects", "HND"], { headers: { ...csrf, origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("forwards same-origin writes with their body", async () => {
    const { fetchFn, run } = setup();
    const res = await run("PUT", ["projects", "HND", "rules"], { headers: csrf, body: '{"rules":[]}' });
    expect(res.status).toBe(200);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe('{"rules":[]}');
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("rejects methods other than GET/POST/PUT/PATCH", async () => {
    const { run } = setup();
    expect((await run("DELETE", ["projects", "HND"], { headers: csrf })).status).toBe(405);
  });

  it("passes through API error statuses", async () => {
    const { run } = setup(new Response(JSON.stringify({ error: "project is not enabled" }), { status: 409, headers: { "content-type": "application/json" } }));
    const res = await run("POST", ["projects", "HND", "ingest"], { headers: csrf });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "project is not enabled" });
  });

  it("returns 502 when the API is unreachable, without leaking the error text", async () => {
    const { run } = setup(new Error(`connect ECONNREFUSED ${API} with ${TOKEN}`));
    const res = await run("GET", ["projects"]);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it("fails with 500 when the server has no token configured", async () => {
    const res = await handleProxy({ request: new Request("http://localhost:3000/x"), segments: ["projects"], apiUrl: API, token: "", fetchFn: vi.fn() as unknown as typeof fetch });
    expect(res.status).toBe(500);
  });
});
