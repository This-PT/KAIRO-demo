import { describe, expect, it } from "vitest";
import { LoginLimiter } from "./access";
import { handleLogin, handleLogout } from "./login";
import { SESSION_COOKIE, deriveSecret, verifySessionToken } from "./session";

const env = { appPassword: "open sesame 123", adminToken: "admin-token-1234567890" };
const NOW = 1_800_000_000_000;

const login = (fields: Record<string, string>, o: { headers?: Record<string, string>; url?: string; limiter?: LoginLimiter; env?: typeof env | { appPassword: string; adminToken: string } } = {}) =>
  handleLogin({
    request: new Request(o.url ?? "http://localhost:3000/api/login", {
      method: "POST",
      headers: { origin: "http://localhost:3000", "content-type": "application/x-www-form-urlencoded", ...o.headers },
      body: new URLSearchParams(fields).toString(),
    }),
    env: o.env ?? env,
    limiter: o.limiter ?? new LoginLimiter(5, 60_000),
    now: NOW,
  });

const cookie = (r: Response) => r.headers.get("set-cookie") ?? "";

describe("handleLogin", () => {
  it("accepts the right password: 303 to the target, with a signed, hardened session cookie", async () => {
    const r = await login({ password: env.appPassword, next: "/history/HND-1" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/history/HND-1");
    const c = cookie(r);
    expect(c).toMatch(new RegExp(`^${SESSION_COOKIE}=`));
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Strict");
    expect(c).toContain("Path=/");
    expect(c).toMatch(/Max-Age=\d+/);
    expect(c).not.toContain("Secure"); // plain http on localhost
    const token = c.split(";")[0]!.split("=")[1]!;
    expect(await verifySessionToken(token, await deriveSecret(env.adminToken, env.appPassword), NOW + 1000)).toBe(true);
  });

  it("marks the cookie Secure over https or behind an https proxy", async () => {
    expect(cookie(await login({ password: env.appPassword }, { url: "https://demo.example.com/api/login", headers: { origin: "https://demo.example.com" } }))).toContain("Secure");
    expect(cookie(await login({ password: env.appPassword }, { headers: { "x-forwarded-proto": "https" } }))).toContain("Secure");
  });

  it("sends a wrong password back to the login page without a cookie", async () => {
    const r = await login({ password: "nope", next: "/tree" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login?error=1&next=%2Ftree");
    expect(cookie(r)).toBe("");
  });

  it("never redirects off-site, whatever next says", async () => {
    for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      expect((await login({ password: env.appPassword, next })).headers.get("location")).toBe("/");
    }
  });

  it("blocks brute force: after 5 wrong guesses even the right password gets 429", async () => {
    const limiter = new LoginLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) await login({ password: `wrong${i}` }, { limiter, headers: { "x-forwarded-for": "9.9.9.9" } });
    const r = await login({ password: env.appPassword }, { limiter, headers: { "x-forwarded-for": "9.9.9.9" } });
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    expect(cookie(r)).toBe("");
    // another client is unaffected
    expect((await login({ password: env.appPassword }, { limiter, headers: { "x-forwarded-for": "8.8.8.8" } })).status).toBe(303);
  });

  it("rejects cross-site form posts", async () => {
    const r = await login({ password: env.appPassword }, { headers: { origin: "https://evil.example" } });
    expect(r.status).toBe(403);
    expect(cookie(r)).toBe("");
  });

  it("refuses to work when no password is configured", async () => {
    const r = await login({ password: "" }, { env: { appPassword: "", adminToken: env.adminToken } });
    expect(r.status).toBe(503);
    expect(cookie(r)).toBe("");
  });

  it("ignores absurdly long or missing passwords", async () => {
    expect((await login({ password: "x".repeat(5000) })).headers.get("location")).toContain("/login?error=1");
    expect((await login({})).headers.get("location")).toContain("/login?error=1");
  });

  it("never reveals the password or token in any response", async () => {
    const r = await login({ password: env.appPassword });
    const all = [...r.headers.entries()].join("|") + (await r.text());
    expect(all).not.toContain(env.appPassword);
    expect(all).not.toContain(env.adminToken);
  });
});

describe("handleLogout", () => {
  it("clears the cookie and returns to the login page", async () => {
    const r = await handleLogout(new Request("http://localhost:3000/api/logout", { method: "POST", headers: { origin: "http://localhost:3000" } }));
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/login");
    expect(cookie(r)).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(cookie(r)).toContain("Max-Age=0");
  });
  it("rejects cross-site logout requests", async () => {
    const r = await handleLogout(new Request("http://localhost:3000/api/logout", { method: "POST", headers: { origin: "https://evil.example" } }));
    expect(r.status).toBe(403);
  });
});

describe("global limit (spoofed client addresses)", () => {
  it("still blocks when each guess claims a different x-forwarded-for", async () => {
    const limiter = new LoginLimiter(5, 60_000);
    const globalLimiter = new LoginLimiter(3, 60_000);
    const attempt = (ip: string, password: string) =>
      handleLogin({
        request: new Request("http://localhost:3000/api/login", { method: "POST", headers: { origin: "http://localhost:3000", "x-forwarded-for": ip, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ password }).toString() }),
        env,
        limiter,
        globalLimiter,
        now: NOW,
      });
    for (let i = 0; i < 3; i++) expect((await attempt(`1.1.1.${i}`, "wrong")).status).toBe(303);
    expect((await attempt("2.2.2.2", env.appPassword)).status).toBe(429);
  });
});

describe("login from a real browser (Origin: null + Sec-Fetch-Site: same-origin)", () => {
  it("signs in", async () => {
    const r = await login({ password: env.appPassword }, { headers: { origin: "null", "sec-fetch-site": "same-origin" } });
    expect(r.status).toBe(303);
    expect(cookie(r)).toContain(SESSION_COOKIE);
  });
  it("still refuses a cross-site form post", async () => {
    const r = await login({ password: env.appPassword }, { headers: { origin: "null", "sec-fetch-site": "cross-site" } });
    expect(r.status).toBe(403);
  });
  it("logs out", async () => {
    const r = await handleLogout(new Request("http://localhost:3000/api/logout", { method: "POST", headers: { origin: "null", "sec-fetch-site": "same-origin" } }));
    expect(r.status).toBe(303);
  });
});
