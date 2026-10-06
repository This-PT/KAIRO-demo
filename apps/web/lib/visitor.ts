// Web Crypto only, so this also runs in the Edge middleware.

export const VISITOR_COOKIE = "handover_visitor";
export const VISITOR_HEADER = "x-visitor-id";

const RE = /^[a-f0-9]{32}$/;
export const isVisitorId = (v: unknown): v is string => typeof v === "string" && RE.test(v);

export function newVisitorId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Builds the request headers the rest of the app sees: x-visitor-id always comes from the visitor's own cookie
 * (or a freshly minted id). Whatever the client sent in that header is discarded, so nobody can claim another visitor's id.
 */
export function prepareVisitorHeaders(incoming: Headers, cookieValue: string | undefined): { headers: Headers; newId: string | null } {
  const headers = new Headers(incoming);
  headers.delete(VISITOR_HEADER);
  const id = isVisitorId(cookieValue) ? cookieValue : newVisitorId();
  headers.set(VISITOR_HEADER, id);
  return { headers, newId: id === cookieValue ? null : id };
}

export function visitorCookie(id: string, secure: boolean): string {
  return `${VISITOR_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${secure ? "; Secure" : ""}`;
}
