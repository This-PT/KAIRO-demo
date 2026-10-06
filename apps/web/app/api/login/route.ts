import { LoginLimiter } from "@/lib/access";
import { handleLogin } from "@/lib/login";

export const dynamic = "force-dynamic";

// Per-client and global failure counters (in memory, per server process).
const limiter = new LoginLimiter(5, 15 * 60_000);
const globalLimiter = new LoginLimiter(50, 15 * 60_000);

export async function POST(request: Request) {
  return handleLogin({
    request,
    env: { appPassword: process.env.APP_PASSWORD ?? "", adminToken: process.env.ADMIN_TOKEN ?? "" },
    limiter,
    globalLimiter,
  });
}
