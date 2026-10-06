import { handleLogout } from "@/lib/login";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleLogout(request);
}
