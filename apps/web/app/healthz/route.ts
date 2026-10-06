export const dynamic = "force-dynamic";

/** Liveness probe for the hosting platform. Public, and deliberately says nothing about the app's internals. */
export function GET() {
  return new Response("ok", { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}
