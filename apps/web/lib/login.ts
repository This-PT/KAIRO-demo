import { LoginLimiter, passwordMatches, safeNext } from "./access";
import { sameOrigin } from "./origin";
import { SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, deriveSecret } from "./session";

export interface LoginEnv {
  appPassword: string;
  adminToken: string;
}

const text = (status: number, body: string, headers: Record<string, string> = {}) => new Response(body, { status, headers: { "content-type": "text/plain", ...headers } });
const redirect = (location: string, headers: Record<string, string> = {}) => new Response(null, { status: 303, headers: { location, ...headers } });

const isHttps = (request: Request) => new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
const cookie = (value: string, maxAgeSec: number, secure: boolean) => `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure ? "; Secure" : ""}`;
const clientKey = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export async function handleLogin(i: { request: Request; env: LoginEnv; limiter: LoginLimiter; globalLimiter?: LoginLimiter; now?: number }): Promise<Response> {
  const now = i.now ?? Date.now();
  if (!sameOrigin(i.request)) return text(403, "forbidden");
  if (!i.env.appPassword) return text(503, "Login is not configured (APP_PASSWORD is not set).");

  // The per-client limit can be dodged by spoofing x-forwarded-for, so there is also a global limit.
  const key = clientKey(i.request);
  for (const [limiter, k] of [[i.limiter, key], ...(i.globalLimiter ? ([[i.globalLimiter, "*"]] as const) : [])] as const) {
    const c = limiter.check(k, now);
    if (!c.allowed) return text(429, "Too many attempts. Try again later.", { "retry-after": String(c.retryAfterSec) });
  }

  const form = await i.request.formData().catch(() => null);
  const password = String(form?.get("password") ?? "");
  const next = safeNext(String(form?.get("next") ?? ""));

  if (password.length > 0 && password.length <= 200 && (await passwordMatches(password, i.env.appPassword))) {
    i.limiter.success(key);
    const token = await createSessionToken(await deriveSecret(i.env.adminToken, i.env.appPassword), now);
    return redirect(next, { "set-cookie": cookie(token, Math.floor(SESSION_TTL_MS / 1000), isHttps(i.request)) });
  }

  i.limiter.fail(key, now);
  i.globalLimiter?.fail("*", now);
  return redirect(`/login?error=1${next !== "/" ? `&next=${encodeURIComponent(next)}` : ""}`);
}

export async function handleLogout(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return text(403, "forbidden");
  return redirect("/login", { "set-cookie": cookie("", 0, isHttps(request)) });
}
