import { describe, expect, it } from "vitest";
import { sameOrigin } from "./origin";

const req = (url: string, headers: Record<string, string>) => new Request(url, { method: "POST", headers });

describe("sameOrigin", () => {
  it("accepts requests with no Origin header (non-browser clients)", () => expect(sameOrigin(req("http://localhost:3000/x", {}))).toBe(true));

  it("accepts an Origin that matches the URL host", () => {
    expect(sameOrigin(req("http://localhost:3000/x", { origin: "http://localhost:3000" }))).toBe(true);
  });

  it("uses the public host from x-forwarded-host when the server only sees an internal URL (behind a proxy, bound to 0.0.0.0)", () => {
    expect(sameOrigin(req("http://0.0.0.0:10000/api/proxy/chat", { origin: "https://demo.onrender.com", "x-forwarded-host": "demo.onrender.com" }))).toBe(true);
  });

  it("uses the Host header when there is no x-forwarded-host", () => {
    expect(sameOrigin(req("http://0.0.0.0:10000/x", { origin: "https://demo.onrender.com", host: "demo.onrender.com" }))).toBe(true);
  });

  it("rejects an Origin from another site, even if the forwarded host is the real one", () => {
    expect(sameOrigin(req("http://0.0.0.0:10000/x", { origin: "https://evil.example", "x-forwarded-host": "demo.onrender.com" }))).toBe(false);
    expect(sameOrigin(req("http://localhost:3000/x", { origin: "https://evil.example" }))).toBe(false);
  });

  it("rejects look-alike hosts (suffix and port tricks)", () => {
    expect(sameOrigin(req("http://x/y", { origin: "https://demo.onrender.com.evil.example", "x-forwarded-host": "demo.onrender.com" }))).toBe(false);
    expect(sameOrigin(req("http://x/y", { origin: "https://demo.onrender.com:8443", "x-forwarded-host": "demo.onrender.com" }))).toBe(false);
  });

  it("rejects a malformed Origin", () => expect(sameOrigin(req("http://localhost:3000/x", { origin: "not a url" }))).toBe(false));
});

import { publicOrigin } from "./origin";

describe("publicOrigin", () => {
  const get = (url: string, headers: Record<string, string> = {}) => publicOrigin(new Request(url, { headers }));

  it("uses the request's own URL when there are no proxy headers", () => {
    expect(get("http://localhost:3000/history")).toBe("http://localhost:3000");
  });
  it("uses the public host and protocol sent by the proxy, not the internal address", () => {
    expect(get("http://0.0.0.0:10000/history", { "x-forwarded-host": "demo.onrender.com", "x-forwarded-proto": "https" })).toBe("https://demo.onrender.com");
  });
  it("falls back to the Host header, then to the URL", () => {
    expect(get("http://0.0.0.0:10000/x", { host: "demo.onrender.com" })).toBe("http://demo.onrender.com");
  });
  it("accepts a port in the host", () => expect(get("http://x/y", { "x-forwarded-host": "demo.example.com:8443", "x-forwarded-proto": "https" })).toBe("https://demo.example.com:8443"));

  it.each(["evil.com/path", "evil.com@good.com", "a b", "", "//evil.com", "evil.com?x=1", "ev!l.com", "x".repeat(300)])(
    "never lets a malformed forwarded host (%j) decide where visitors are sent",
    (bad) => {
      expect(get("http://localhost:3000/x", { "x-forwarded-host": bad })).toBe("http://localhost:3000");
    },
  );
  it("only accepts http and https as the protocol", () => {
    expect(get("http://localhost:3000/x", { "x-forwarded-proto": "javascript" })).toBe("http://localhost:3000");
    expect(get("http://localhost:3000/x", { "x-forwarded-proto": "https, http" })).toBe("https://localhost:3000");
  });
});

describe("sameOrigin with Sec-Fetch-Site (what real browsers send)", () => {
  const post = (headers: Record<string, string>) => new Request("http://0.0.0.0:10000/api/login", { method: "POST", headers });

  it("accepts a same-origin post even when the browser sends Origin: null (it does under Referrer-Policy: no-referrer)", () => {
    expect(sameOrigin(post({ origin: "null", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("accepts a same-origin post with no Origin at all", () => {
    expect(sameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("rejects cross-site and same-site (other subdomain) posts, whatever Origin says", () => {
    expect(sameOrigin(post({ origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(sameOrigin(post({ origin: "https://app.demo.onrender.com", "sec-fetch-site": "same-site", host: "demo.onrender.com" }))).toBe(false);
    expect(sameOrigin(post({ origin: "https://demo.onrender.com", "sec-fetch-site": "cross-site", host: "demo.onrender.com" }))).toBe(false);
  });
  it("does not accept 'none' for a post", () => {
    expect(sameOrigin(post({ "sec-fetch-site": "none" }))).toBe(false);
  });
  it("without Sec-Fetch-Site (older clients) an Origin of null is still rejected", () => {
    expect(sameOrigin(post({ origin: "null" }))).toBe(false);
  });
});
