import { NextResponse, type NextRequest } from "next/server";
import { decideAccess } from "@/lib/access";
import { publicOrigin } from "@/lib/origin";
import { VISITOR_COOKIE, prepareVisitorHeaders, visitorCookie } from "@/lib/visitor";
import { SESSION_COOKIE, deriveSecret, verifySessionToken } from "@/lib/session";

export async function middleware(req: NextRequest) {
  const password = process.env.APP_PASSWORD ?? "";
  const gateEnabled = password.length > 0;
  const { pathname, search } = req.nextUrl;

  const authed = gateEnabled ? await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, await deriveSecret(process.env.ADMIN_TOKEN ?? "", password)) : false;
  const access = decideAccess({ pathname, authed, gateEnabled, production: process.env.NODE_ENV === "production" });

  if (access === "allow") {
    // Every request carries a private, anonymous visitor id that only the server can set (used to keep chat history per browser).
    const { headers, newId } = prepareVisitorHeaders(req.headers, req.cookies.get(VISITOR_COOKIE)?.value);
    const res = NextResponse.next({ request: { headers } });
    if (newId) res.headers.append("set-cookie", visitorCookie(newId, req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"));
    return res;
  }
  if (access === "deny") return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (access === "misconfigured") return new NextResponse("This server is not configured: set APP_PASSWORD before serving it publicly.", { status: 503 });

  // Absolute, built from the address the visitor used: the server's own URL can be internal or http behind a proxy.
  const path = pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(new URL(path, publicOrigin(req)));
}

// Everything except Next's static assets runs through the gate.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
