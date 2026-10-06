/**
 * Cross-site request check for form posts and proxied writes.
 * Behind a reverse proxy (or when the server is bound to 0.0.0.0) request.url carries an internal host,
 * so the public host is taken from x-forwarded-host or the Host header first.
 * A browser always sends Origin on cross-site posts and a page on another site cannot set these headers.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true; // non-browser clients
  try {
    const expected = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/**
 * The address visitors actually used, for building absolute redirects. Behind a proxy request.url carries an internal
 * address, so x-forwarded-host / x-forwarded-proto (or the Host header) win. Anything that does not look like a plain
 * host is ignored, so a crafted header cannot send visitors to another site.
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = [request.headers.get("x-forwarded-host"), request.headers.get("host")].find((h) => h && HOST_RE.test(h)) ?? url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return `${proto === "http" || proto === "https" ? proto : url.protocol.replace(":", "")}://${host}`;
}
