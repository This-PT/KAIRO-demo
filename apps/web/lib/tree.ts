import { confidenceTone } from "./format";

export const NODE_W = 240;
export const NODE_H = 78;
export const COL_W = 320;
export const ROW_H = 102;

export interface TreeNode {
  key: string;
  parent: string | null;
  issueType: string;
}
export interface Layout {
  positions: Record<string, { x: number; y: number; depth: number }>;
  width: number;
  height: number;
}

const byOrder = (a: TreeNode, b: TreeNode) => {
  const ea = a.issueType === "Epic" ? 0 : 1;
  const eb = b.issueType === "Epic" ? 0 : 1;
  return ea - eb || a.key.localeCompare(b.key, undefined, { numeric: true });
};

/**
 * Left-to-right tidy tree: depth sets the column, leaves take consecutive rows, a parent sits between its children.
 * Missing parents and parent cycles are tolerated: the offending node simply becomes a root.
 */
export function layoutTree(input: TreeNode[]): Layout {
  const nodes = [...input].sort(byOrder);
  const keys = new Set(nodes.map((n) => n.key));
  const children = new Map<string, TreeNode[]>();
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    if (n.parent && n.parent !== n.key && keys.has(n.parent)) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
    else roots.push(n);
  }

  const positions: Layout["positions"] = {};
  const visited = new Set<string>();
  let nextRow = 0;

  const place = (n: TreeNode, depth: number): number => {
    visited.add(n.key);
    const kids = (children.get(n.key) ?? []).filter((c) => !visited.has(c.key));
    let y: number;
    if (kids.length === 0) {
      y = nextRow++ * ROW_H;
    } else {
      const ys = kids.map((c) => (visited.has(c.key) ? positions[c.key]!.y : place(c, depth + 1)));
      y = (ys[0]! + ys[ys.length - 1]!) / 2;
    }
    positions[n.key] = { x: depth * COL_W, y, depth };
    return y;
  };

  for (const r of roots) if (!visited.has(r.key)) place(r, 0);
  // Anything left is part of a parent cycle: break it at the first node in order.
  for (const n of nodes) if (!visited.has(n.key)) place(n, 0);

  const all = Object.values(positions);
  return {
    positions,
    width: all.length ? Math.max(...all.map((p) => p.x)) + NODE_W : 0,
    height: all.length ? Math.max(...all.map((p) => p.y)) + NODE_H : 0,
  };
}

type Pt = { x: number; y: number };

/** Smooth connector between two node boxes, leaving and entering on the sides that face each other. */
export function edgePath(from: Pt, to: Pt): string {
  const midY = NODE_H / 2;
  const sameColumn = to.x === from.x;
  const rightward = to.x > from.x;
  const sx = sameColumn || rightward ? from.x + NODE_W : from.x;
  const ex = sameColumn ? to.x + NODE_W : rightward ? to.x : to.x + NODE_W;
  const sy = from.y + midY;
  const ey = to.y + midY;
  const dx = sameColumn ? 60 : Math.max(40, Math.abs(ex - sx) / 2);
  const dir = sameColumn || rightward ? 1 : -1;
  return `M ${sx} ${sy} C ${sx + dir * dx} ${sy}, ${ex - (sameColumn ? -dx : dir * dx)} ${ey}, ${ex} ${ey}`;
}

export interface View {
  x: number;
  y: number;
  k: number;
}
const MIN_K = 0.2;
const MAX_K = 2.5;
const clamp = (v: number) => Math.min(MAX_K, Math.max(MIN_K, v));

/** Zoom by `factor` keeping the screen point (cx, cy) fixed. */
export function zoomAt(v: View, factor: number, cx: number, cy: number): View {
  const k = clamp(v.k * factor);
  const r = k / v.k;
  return { x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r, k };
}

/**
 * Fits the content in the viewport. With `minScale`, a big tree stays readable instead of shrinking to a speck:
 * content that still overflows is anchored to the top-left (where the roots are) and can be panned.
 */
export function fitView(content: { width: number; height: number }, viewport: { width: number; height: number }, pad = 40, minScale = 0): View {
  if (content.width === 0 || content.height === 0) return { x: 0, y: 0, k: 1 };
  const k = clamp(Math.max(minScale, Math.min(1, (viewport.width - 2 * pad) / content.width, (viewport.height - 2 * pad) / content.height)));
  const place = (size: number, avail: number) => (size * k > avail - 2 * pad ? pad : (avail - size * k) / 2);
  return { x: place(content.width, viewport.width), y: place(content.height, viewport.height), k };
}

export type NodeTone = "good" | "warn" | "bad" | "none" | "locked";
export function nodeTone(n: { visibility: string; summary: { status: string; confidence: string } | null }): NodeTone {
  if (n.visibility === "restricted") return "locked";
  if (!n.summary) return "none";
  if (n.summary.status === "rejected") return "bad";
  return confidenceTone(n.summary.confidence);
}
