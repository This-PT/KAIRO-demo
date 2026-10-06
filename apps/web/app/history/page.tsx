import { Badge } from "@/components/Badge";
import { SourceLink } from "@/components/SourceLink";
import { apiGet, type Project, type TicketListItem } from "@/lib/api";
import { confidenceTone } from "@/lib/format";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function HistoryPage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const q = one(sp.q)?.trim() || undefined;
  const visibility = one(sp.visibility) === "readable" || one(sp.visibility) === "restricted" ? one(sp.visibility) : undefined;
  const project = one(sp.project) || undefined;
  const page = Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1);

  const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (q) qs.set("q", q);
  if (visibility) qs.set("visibility", visibility);
  if (project) qs.set("project", project);

  const [data, projects, connection] = await Promise.all([
    apiGet<{ total: number; items: TicketListItem[] }>(`/api/tickets?${qs}`),
    apiGet<Project[]>("/api/projects"),
    apiGet<{ mode: "demo" | "jira" }>("/api/connection"),
  ]);
  const demo = connection.mode === "demo";

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (p: number) => {
    const n = new URLSearchParams();
    if (q) n.set("q", q);
    if (visibility) n.set("visibility", visibility);
    if (project) n.set("project", project);
    n.set("page", String(p));
    return `/history?${n}`;
  };
  const field = "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Task History</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500">Search titles</span>
          <input name="q" defaultValue={q} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500">Project</span>
          <select name="project" defaultValue={project ?? ""} className={field}>
            <option value="">All</option>
            {projects.map((p) => (
              <option key={p.key} value={p.key}>
                {p.key}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-zinc-500">Visibility</span>
          <select name="visibility" defaultValue={visibility ?? ""} className={field}>
            <option value="">All</option>
            <option value="readable">Readable</option>
            <option value="restricted">Restricted</option>
          </select>
        </label>
        <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          Filter
        </button>
      </form>

      {data.items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No tickets found. {data.total === 0 && !q && !visibility && !project ? <>Go to <a href="/settings" className="text-blue-600 hover:underline dark:text-blue-400">Connect &amp; Policy</a>, enable a project and run an ingest.</> : "Try different filters."}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {data.items.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center gap-3 p-3">
              <a href={`/history/${encodeURIComponent(t.key)}`} className="w-24 shrink-0 font-mono text-sm text-blue-600 underline underline-offset-2 dark:text-blue-400">
                {t.key}
              </a>
              <a href={`/history/${encodeURIComponent(t.key)}`} className="min-w-48 flex-1 hover:underline">
                {t.title}
              </a>
              <Badge tone={t.visibility === "restricted" ? "bad" : "neutral"}>{t.visibility}</Badge>
              {t.summary ? <Badge tone={t.summary.status === "rejected" ? "bad" : confidenceTone(t.summary.confidence)}>{t.summary.status === "rejected" ? "rejected" : `${t.summary.confidence} confidence`}</Badge> : t.visibility === "readable" ? <Badge>not summarized</Badge> : null}
              <span className="text-sm">
                {t.visibility === "readable" || !demo ? <SourceLink url={t.url} label="Source" demoHref={demo ? `/history/${encodeURIComponent(t.key)}#source` : undefined} /> : null}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          {data.total} ticket(s) · page {page} of {pages}
        </span>
        <span className="flex gap-4">
          {page > 1 && <a href={link(page - 1)}>← Previous</a>}
          {page < pages && <a href={link(page + 1)}>Next →</a>}
        </span>
      </div>
    </div>
  );
}
