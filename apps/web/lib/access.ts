import { timingEqual } from "./session";

const PUBLIC_EXACT = new Set(["/login", "/api/login", "/api/logout", "/favicon.ico", "/healthz"]);

export type Access = "allow" | "login" | "deny" | "misconfigured";

/**
 * Decides what to do with a request.
 * Public: the login page, login/logout endpoints and static files. Everything else needs a valid session.
 * Without a configured password, development stays open, but production refuses to serve anything.
 */
export function decideAccess(i: { pathname: string; authed: boolean; gateEnabled: boolean; production: boolean }): Access {
  if (PUBLIC_EXACT.has(i.pathname) || i.pathname.startsWith("/_next/")) return "allow";
  if (!i.gateEnabled) return i.production ? "misconfigured" : "allow";
  if (i.authed) return "allow";
  return i.pathname.startsWith("/api/") ? "deny" : "login";
}

/** Where to go after login. Only same-site paths are accepted, so the login page cannot be used to bounce users elsewhere. */
export function safeNext(next: string | null | undefined): string {
  if (!next || typeof next !== "string" || next.length > 500) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || /[\u0000-\u001f]/.test(next) || /%0d|%0a/i.test(next)) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login/")) return "/";
  return next;
}

async function digest(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time password check (both sides are hashed first, so length does not leak). */
export async function passwordMatches(input: string, expected: string): Promise<boolean> {
  if (!expected) return false;
  return timingEqual(await digest(input), await digest(expected));
}

/** Counts failed logins per client within a time window. In memory, bounded in size. */
export class LoginLimiter {
  private readonly entries = new Map<string, { count: number; first: number }>();
  constructor(
    private readonly max = 5,
    private readonly windowMs = 15 * 60_000,
    private readonly maxKeys = 1000,
  ) {}

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSec: number } {
    const e = this.entries.get(key);
    if (!e || now - e.first > this.windowMs) {
      this.entries.delete(key);
      return { allowed: true, retryAfterSec: 0 };
    }
    if (e.count < this.max) return { allowed: true, retryAfterSec: 0 };
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((e.first + this.windowMs - now) / 1000)) };
  }

  fail(key: string, now = Date.now()): void {
    const e = this.entries.get(key);
    if (e && now - e.first <= this.windowMs) e.count++;
    else this.entries.set(key, { count: 1, first: now });
    while (this.entries.size > this.maxKeys) this.entries.delete(this.entries.keys().next().value as string);
  }

  success(key: string): void {
    this.entries.delete(key);
  }

  size(): number {
    return this.entries.size;
  }
}
