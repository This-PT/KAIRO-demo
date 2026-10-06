import { sameOrigin } from "./origin";
import { VISITOR_HEADER, isVisitorId } from "./visitor";

const SEGMENT = /^[A-Za-z0-9._-]+$/;
const AREAS = new Set(["connection", "projects", "tickets", "audit", "chat"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH"]);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export interface ProxyInput {
  request: Request;
  segments: string[];
  apiUrl: string;
  /** Server-side admin token. Never sent to the browser. */
  token: string;
  fetchFn?: typeof fetch;
}

/**
 * Forwards browser calls to the API with the admin token attached on the server.
 * Guards: strict path segments, known API areas only, and for writes a custom header plus same-origin check (CSRF).
 */
export async function handleProxy(i: ProxyInput): Promise<Response> {
  if (i.segments.length === 0 || i.segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) return json(400, { error: "invalid path" });
  if (!AREAS.has(i.segments[0]!)) return json(404, { error: "not found" });

  const method = i.request.method.toUpperCase();
  if (!METHODS.has(method)) return json(405, { error: "method not allowed" });

  if (method !== "GET") {
    if (i.request.headers.get("x-requested-with") !== "kairo") return json(403, { error: "forbidden" });
    if (!sameOrigin(i.request)) return json(403, { error: "forbidden" });
  }

  if (!i.token) return json(500, { error: "server is not configured (ADMIN_TOKEN missing)" });

  const headers: Record<string, string> = { authorization: `Bearer ${i.token}`, accept: "application/json" };
  // Set by the middleware from the visitor's own cookie. Only well-formed ids are passed on.
  const visitor = i.request.headers.get(VISITOR_HEADER);
  if (isVisitorId(visitor)) headers[VISITOR_HEADER] = visitor;
  const ct = i.request.headers.get("content-type");
  if (ct) headers["content-type"] = ct;

  try {
    const res = await (i.fetchFn ?? fetch)(`${i.apiUrl}/api/${i.segments.join("/")}${new URL(i.request.url).search}`, {
      method,
      headers,
      body: method === "GET" ? undefined : await i.request.text(),
      cache: "no-store",
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
  } catch {
    // Never echo the underlying error: it can contain the URL and headers.
    return json(502, { error: "API unreachable" });
  }
}
