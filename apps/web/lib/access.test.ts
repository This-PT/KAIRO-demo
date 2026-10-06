import { describe, expect, it } from "vitest";
import { LoginLimiter, decideAccess, passwordMatches, safeNext } from "./access";

describe("decideAccess", () => {
  const base = { authed: false, gateEnabled: true, production: true };
  it("lets anyone reach the login page, the login/logout endpoints and static files", () => {
    for (const pathname of ["/login", "/api/login", "/api/logout", "/_next/static/x.js", "/favicon.ico"]) {
      expect(decideAccess({ ...base, pathname }), pathname).toBe("allow");
    }
  });
  it("sends unauthenticated page requests to login", () => {
    for (const pathname of ["/", "/history", "/history/HND-1", "/tree", "/ask", "/settings", "/audit"]) expect(decideAccess({ ...base, pathname }), pathname).toBe("login");
  });
  it("answers unauthenticated API requests (including the proxy) with 401, not a redirect", () => {
    expect(decideAccess({ ...base, pathname: "/api/proxy/projects" })).toBe("deny");
    expect(decideAccess({ ...base, pathname: "/api/anything" })).toBe("deny");
  });
  it("allows authenticated requests everywhere", () => {
    for (const pathname of ["/history", "/api/proxy/chat", "/ask"]) expect(decideAccess({ ...base, authed: true, pathname })).toBe("allow");
  });
  it("does not treat look-alike paths as public", () => {
    for (const pathname of ["/login/../history", "/loginx", "/api/login/extra", "/api/loginx"]) expect(decideAccess({ ...base, pathname }), pathname).not.toBe("allow");
  });
  it("without a password, development stays open but production refuses to serve", () => {
    expect(decideAccess({ authed: false, gateEnabled: false, production: false, pathname: "/history" })).toBe("allow");
    expect(decideAccess({ authed: false, gateEnabled: false, production: true, pathname: "/history" })).toBe("misconfigured");
    expect(decideAccess({ authed: false, gateEnabled: false, production: true, pathname: "/api/proxy/projects" })).toBe("misconfigured");
  });
});

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/history/HND-1")).toBe("/history/HND-1");
    expect(safeNext("/history?q=a&page=2")).toBe("/history?q=a&page=2");
  });
  it.each([null, undefined, "", "history", "//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "/ok\nSet-Cookie: x=1", "/%0d%0a", "///evil.com"])("falls back to / for %j", (v) => {
    expect(safeNext(v as string | null)).toBe("/");
  });
  it("does not bounce back to the login page", () => expect(safeNext("/login?error=1")).toBe("/"));
});

describe("passwordMatches", () => {
  it("matches only the exact password", async () => {
    expect(await passwordMatches("correct horse", "correct horse")).toBe(true);
    expect(await passwordMatches("correct horse ", "correct horse")).toBe(false);
    expect(await passwordMatches("Correct horse", "correct horse")).toBe(false);
    expect(await passwordMatches("", "correct horse")).toBe(false);
  });
  it("never matches an empty expected password", async () => {
    expect(await passwordMatches("", "")).toBe(false);
    expect(await passwordMatches("anything", "")).toBe(false);
  });
});

describe("LoginLimiter", () => {
  const t0 = 1_000_000;
  it("allows up to the maximum number of failures, then blocks with a retry time", () => {
    const l = new LoginLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(l.check("ip", t0).allowed).toBe(true);
      l.fail("ip", t0);
    }
    const r = l.check("ip", t0 + 1000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });
  it("tracks each client separately", () => {
    const l = new LoginLimiter(1, 60_000);
    l.fail("a", t0);
    expect(l.check("a", t0).allowed).toBe(false);
    expect(l.check("b", t0).allowed).toBe(true);
  });
  it("forgets failures after the window", () => {
    const l = new LoginLimiter(1, 60_000);
    l.fail("a", t0);
    expect(l.check("a", t0 + 60_001).allowed).toBe(true);
  });
  it("a successful login clears the count", () => {
    const l = new LoginLimiter(2, 60_000);
    l.fail("a", t0);
    l.success("a");
    l.fail("a", t0);
    expect(l.check("a", t0).allowed).toBe(true);
  });
  it("keeps memory bounded", () => {
    const l = new LoginLimiter(5, 60_000, 50);
    for (let i = 0; i < 500; i++) l.fail(`ip${i}`, t0);
    expect(l.size()).toBeLessThanOrEqual(50);
  });
});

describe("health check endpoint", () => {
  it("is public so the hosting platform can probe it without a session", () => {
    expect(decideAccess({ pathname: "/healthz", authed: false, gateEnabled: true, production: true })).toBe("allow");
    expect(decideAccess({ pathname: "/healthz", authed: false, gateEnabled: false, production: true })).toBe("allow");
  });
  it("does not open look-alike paths", () => {
    expect(decideAccess({ pathname: "/healthz/x", authed: false, gateEnabled: true, production: true })).not.toBe("allow");
    expect(decideAccess({ pathname: "/health", authed: false, gateEnabled: true, production: true })).not.toBe("allow");
  });
});
