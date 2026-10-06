// Web Crypto only, so this runs in the Edge middleware as well as in route handlers.

export const SESSION_COOKIE = "kairo_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Constant-time comparison of two strings of (publicly known) equal length. */
export function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * The signing key is derived from server-side values, so no extra secret has to be configured.
 * Changing the password or the admin token invalidates every existing session.
 */
export async function deriveSecret(adminToken: string, appPassword: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(`kairo-session|${adminToken}|${appPassword}`)));
}

/** Token format: `<expiry-ms>.<hmac(expiry)>`. Stateless: nothing is stored on the server. */
export async function createSessionToken(secret: string, now = Date.now()): Promise<string> {
  if (!secret) throw new Error("a signing secret is required");
  const expiry = String(now + SESSION_TTL_MS);
  return `${expiry}.${await hmac(secret, expiry)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expiry, mac] = parts as [string, string];
  if (!/^\d{10,15}$/.test(expiry)) return false;
  const exp = Number(expiry);
  if (exp < now || exp > now + SESSION_TTL_MS + 60_000) return false;
  return timingEqual(mac, await hmac(secret, expiry));
}

/** Whether to show the signed-in parts of the page. Open (true) when no password is configured, as in local development. */
export async function isSignedIn(cookieValue: string | undefined, env: { APP_PASSWORD?: string; ADMIN_TOKEN?: string }, now = Date.now()): Promise<boolean> {
  if (!env.APP_PASSWORD) return true;
  return verifySessionToken(cookieValue, await deriveSecret(env.ADMIN_TOKEN ?? "", env.APP_PASSWORD), now);
}
