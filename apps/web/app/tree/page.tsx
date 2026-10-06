import { WorkTree } from "@/components/WorkTree";
import { apiGet, type GraphResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

export default async function TreePage({ searchParams }: { searchParams: Params }) {
  const sp = await searchParams;
  const project = one(sp.project);
  const label = one(sp.label);
  const person = one(sp.person);

  const qs = new URLSearchParams();
  if (project) qs.set("project", project);
  if (label) qs.set("label", label);
  if (person) qs.set("person", person);
  const graph = await apiGet<GraphResponse>(`/api/graph${qs.size ? `?${qs}` : ""}`);

  const field = "rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700";
  const select = (name: string, current: string | undefined, options: string[], all: string) => (
    <label className="text-sm">
      <span className="mb-1 block text-zinc-500">{name[0]!.toUpperCase() + name.slice(1)}</span>
      <select name={name} defaultValue={current ?? ""} className={field}>
        <option value="">{all}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Work Tree</h1>
          <p className="text-sm text-zinc-500">How the work fits together: epics, stories and sub-tasks, with links between tickets. Drag to pan, scroll to zoom, click a ticket to read its summary.</p>
        </div>
        <form method="get" className="flex flex-wrap items-end gap-3">
          {select("project", project, graph.facets.projects, "All projects")}
          {select("label", label, graph.facets.labels, "All labels")}
          {select("person", person, graph.facets.people, "Everyone")}
          <button type="submit" className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
            Filter
          </button>
          {(project || label || person) && (
            <a href="/tree" className="py-1.5 text-sm text-zinc-500 underline">
              Clear
            </a>
          )}
        </form>
      </div>
      {graph.truncated && <p className="text-sm text-amber-700 dark:text-amber-400">Showing the first 2000 tickets only. Use the filters to narrow it down.</p>}
      <p className="text-xs text-zinc-500">
        {graph.nodes.length} ticket(s) · {graph.edges.length} link(s)
        {label || person ? " · filtered tickets are shown with their parents" : ""}
      </p>
      <WorkTree nodes={graph.nodes} edges={graph.edges} key={`${project}|${label}|${person}`} />
    </div>
  );
}
