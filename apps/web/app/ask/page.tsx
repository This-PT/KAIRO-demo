import { headers } from "next/headers";
import { Chat } from "@/components/Chat";
import { ApiError, apiGet } from "@/lib/api";
import { suggestionsFor, type ChatMsg } from "@/lib/chat";
import { VISITOR_HEADER, isVisitorId } from "@/lib/visitor";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
interface SessionRow {
  id: string;
  title: string;
  createdAt: string;
}
interface SessionDetail {
  id: string;
  title: string;
  messages: (ChatMsg & { createdAt?: string })[];
}

export default async function AskPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const raw = params.s;
  // A question can be pre-filled from a link (never sent automatically: a page load must not spend AI money).
  const q = params.q;
  const prefill = ((Array.isArray(q) ? q[0] : q) ?? "").slice(0, 300);
  const sessionId = (Array.isArray(raw) ? raw[0] : raw)?.trim() || null;

  // The middleware gives every browser a private id. Without one (it should always be there) show nothing rather than everyone's chats.
  const visitor = (await headers()).get(VISITOR_HEADER);
  const [sessions, current] = isVisitorId(visitor)
    ? await Promise.all([
        apiGet<SessionRow[]>("/api/chat/sessions", visitor),
        sessionId
          ? apiGet<SessionDetail>(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, visitor).catch((e) => {
              if (e instanceof ApiError && e.status === 404) return null;
              throw e;
            })
          : Promise.resolve(null),
      ])
    : [[] as SessionRow[], null];

  const projects = await apiGet<{ key: string }[]>("/api/projects").catch(() => []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Ask AI</h1>
        <p className="text-sm text-zinc-500">Ask about past work and decisions. Only readable tickets are searched; restricted tickets are never used. Every answer shows the quotes behind it, so check the source when it matters. Your conversations are private to this browser.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <aside className="space-y-2">
          <a href="/ask" className="block rounded border border-zinc-300 px-3 py-2 text-center text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            + New chat
          </a>
          <ul className="space-y-1 text-sm">
            {sessions.map((s) => (
              <li key={s.id}>
                <a href={`/ask?s=${encodeURIComponent(s.id)}`} className={`block truncate rounded px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900 ${s.id === current?.id ? "bg-zinc-100 font-medium dark:bg-zinc-900" : "text-zinc-600 dark:text-zinc-400"}`}>
                  {s.title}
                </a>
              </li>
            ))}
            {sessions.length === 0 && <li className="px-2 text-zinc-500">No conversations yet.</li>}
          </ul>
        </aside>
        <Chat key={current?.id ?? "new"} initialSessionId={current?.id ?? null} initialMessages={current?.messages ?? []} suggestions={suggestionsFor(projects.map((p) => p.key))} initialInput={prefill} />
      </div>
    </div>
  );
}
