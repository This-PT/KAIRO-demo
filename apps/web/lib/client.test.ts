import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callApi } from "./client";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("callApi", () => {
  it("sends the CSRF header and goes through the proxy", async () => {
    fetchMock.mockResolvedValue(res(200, { ok: 1 }));
    await callApi("GET", "projects");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/projects");
    expect((init.headers as Record<string, string>)["x-requested-with"]).toBe("handover");
  });

  it("does NOT send a JSON content-type when there is no body (the API rejects empty JSON bodies)", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await callApi("POST", "projects/sync");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sends JSON with a content-type when there is a body", async () => {
    fetchMock.mockResolvedValue(res(200, {}));
    await callApi("PATCH", "projects/HND", { enabled: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe('{"enabled":true}');
  });

  it("throws the API's error message on failure", async () => {
    fetchMock.mockResolvedValue(res(409, { error: "project is not enabled" }));
    await expect(callApi("POST", "projects/HND/ingest")).rejects.toThrow("project is not enabled");
  });

  it("falls back to the status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(callApi("GET", "projects")).rejects.toThrow(/502/);
  });
});
