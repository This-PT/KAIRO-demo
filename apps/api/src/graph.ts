export interface GraphTicket {
  key: string;
  project: string;
  title: string;
  issueType: string;
  status: string;
  visibility: "readable" | "restricted";
  parentKey: string | null;
  assignee: string | null;
  labels: string[];
  url: string;
  summary: { status: string; confidence: string } | null;
}
export interface GraphLink {
  from: string;
  to: string;
  type: string;
}
export interface GraphFilters {
  project?: string;
  label?: string;
  person?: string;
}
export interface GraphNode {
  key: string;
  project: string;
  title: string;
  issueType: string;
  status: string;
  visibility: "readable" | "restricted";
  /** Parent key, only when that parent is part of this graph */
  parent: string | null;
  assignee: string | null;
  labels: string[];
  url: string;
  summary: { status: string; confidence: string } | null;
}
export interface GraphEdge {
  from: string;
  to: string;
  type: string;
}

const lc = (s: string) => s.toLowerCase();

// Jira reports a directional link from both ends ("blocks" / "is blocked by"). Show it once, pointing from cause to effect.
const INVERSE: Record<string, string> = {
  "is blocked by": "blocks",
  "is duplicated by": "duplicates",
  "is cloned by": "clones",
  "is caused by": "causes",
  "is implemented by": "implements",
  "is tested by": "tests",
};
const DIRECTIONAL = new Set(Object.values(INVERSE));

/** Restricted tickets keep only their place in the tree. Everything that could describe them is blanked here, regardless of input. */
function toNode(t: GraphTicket): GraphNode {
  const base = { key: t.key, project: t.project, issueType: t.issueType, parent: null, url: t.url, visibility: t.visibility };
  return t.visibility === "restricted"
    ? { ...base, title: "[Restricted]", status: "restricted", assignee: null, labels: [], summary: null }
    : { ...base, title: t.title, status: t.status, assignee: t.assignee, labels: t.labels, summary: t.summary };
}

/**
 * Builds the work-tree graph: nodes carry their parent (hierarchy), edges are ticket links.
 * Filters keep matching tickets plus their ancestors so the path to the root stays visible.
 */
export function buildGraph(tickets: GraphTicket[], links: GraphLink[], filters: GraphFilters): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const parentOf = new Map(tickets.map((t) => [t.key, t.parentKey]));
  const known = new Set(parentOf.keys());

  const matched = tickets.filter((t) => {
    if (filters.project && t.project !== filters.project) return false;
    const readable = t.visibility === "readable";
    if (filters.label && !(readable && t.labels.some((l) => lc(l) === lc(filters.label!)))) return false;
    if (filters.person && !(readable && t.assignee !== null && lc(t.assignee) === lc(filters.person))) return false;
    return true;
  });

  const keep = new Set(matched.map((t) => t.key));
  const filtered = Boolean(filters.project || filters.label || filters.person);
  if (filtered) {
    for (const t of matched) {
      const seen = new Set<string>([t.key]);
      let p = parentOf.get(t.key) ?? null;
      while (p && known.has(p) && !seen.has(p)) {
        keep.add(p);
        seen.add(p);
        p = parentOf.get(p) ?? null;
      }
    }
  }

  const nodes = tickets
    .filter((t) => keep.has(t.key))
    .map((t) => {
      const n = toNode(t);
      n.parent = t.parentKey && t.parentKey !== t.key && keep.has(t.parentKey) ? t.parentKey : null;
      return n;
    });

  const seenEdges = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const raw of links) {
    const inverse = INVERSE[lc(raw.type)];
    const l = inverse ? { from: raw.to, to: raw.from, type: inverse } : raw;
    if (!keep.has(l.from) || !keep.has(l.to) || l.from === l.to) continue;
    const ends = DIRECTIONAL.has(lc(l.type)) ? [l.from, l.to] : [l.from, l.to].sort();
    const id = ends.join("|") + "|" + l.type;
    if (seenEdges.has(id)) continue;
    seenEdges.add(id);
    edges.push({ from: l.from, to: l.to, type: l.type });
  }
  return { nodes, edges };
}
