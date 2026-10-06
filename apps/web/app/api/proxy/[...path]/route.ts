import { handleProxy } from "@/lib/proxy";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

async function handler(request: Request, ctx: Ctx) {
  return handleProxy({
    request,
    segments: (await ctx.params).path,
    apiUrl: process.env.API_URL ?? "http://127.0.0.1:4000",
    token: process.env.ADMIN_TOKEN ?? "",
  });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH };
