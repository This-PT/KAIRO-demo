"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge, GraphNode } from "@/lib/api";
import { NODE_H, NODE_W, edgePath, fitView, layoutTree, nodeTone, zoomAt, type NodeTone, type View } from "@/lib/tree";

const TONE_BORDER: Record<NodeTone, string> = {
  good: "border-l-green-500",
  warn: "border-l-amber-500",
  bad: "border-l-red-500",
  none: "border-l-zinc-400",
  locked: "border-l-zinc-500 border-dashed bg-zinc-100 dark:bg-zinc-900",
};
const TYPE_CHIP: Record<string, string> = {
  Epic: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  Story: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  Bug: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  Task: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "Sub-task": "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200",
};
const FALLBACK_SIZE = { width: 900, height: 600 };

export function WorkTree({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const layout = useMemo(() => layoutTree(nodes), [nodes]);
  const [view, setView] = useState<View>({ x: 20, y: 20, k: 1 });
  const [showLinks, setShowLinks] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const dragged = useRef(false);

  const size = () => ({ width: box.current?.clientWidth || FALLBACK_SIZE.width, height: box.current?.clientHeight || FALLBACK_SIZE.height });
  const fit = () => setView(fitView(layout, size(), 40, 0.55));

  // Fit whenever the set of tickets changes.
  useEffect(fit, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wheel zoom needs a non-passive listener so the page does not scroll at the same time.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setView((v) => zoomAt(v, e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Pan by dragging. Window-level listeners (no pointer capture) keep clicks on tickets working.
  function startPan(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    dragged.current = false;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged.current = true;
      setView((v) => ({ ...v, x: start.vx + dx, y: start.vy + dy }));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(() => (dragged.current = false), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const zoomBy = (f: number) => {
    const s = size();
    setView((v) => zoomAt(v, f, s.width / 2, s.height / 2));
  };

  if (nodes.length === 0) {
    return <p className="rounded border border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800">No tickets match these filters. Ingest a project first, or clear the filters.</p>;
  }

  const touches = (a: string, b: string) => hovered !== null && (a === hovered || b === hovered);
  const btn = "rounded border border-zinc-300 bg-white/90 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/90 dark:hover:bg-zinc-800";

  return (
    <div className="relative h-[70vh] min-h-96 overflow-hidden rounded border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" ref={box} onPointerDown={startPan} style={{ cursor: "grab", touchAction: "none" }}>
      <div data-testid="canvas" className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" className="fill-red-500" />
            </marker>
          </defs>
          {nodes.map((n) => {
            const from = n.parent ? layout.positions[n.parent] : undefined;
            const to = layout.positions[n.key];
            if (!from || !to || !n.parent) return null;
            return <path key={`p-${n.key}`} data-kind="parent" d={edgePath(from, to)} fill="none" strokeWidth={touches(n.parent, n.key) ? 3 : 1.5} className={touches(n.parent, n.key) ? "stroke-blue-500" : "stroke-zinc-400 dark:stroke-zinc-600"} />;
          })}
          {showLinks &&
            edges.map((e) => {
              const from = layout.positions[e.from];
              const to = layout.positions[e.to];
              if (!from || !to) return null;
              const blocks = e.type === "blocks" || e.type === "is blocked by";
              return (
                <path key={`l-${e.from}-${e.to}-${e.type}`} data-kind="link" d={edgePath(from, to)} fill="none" strokeDasharray="6 4" strokeWidth={touches(e.from, e.to) ? 3 : 1.5} markerEnd={blocks ? "url(#arrow)" : undefined} className={blocks ? "stroke-red-500" : "stroke-sky-500"}>
                  <title>{e.type}</title>
                </path>
              );
            })}
        </svg>

        {nodes.map((n) => {
          const p = layout.positions[n.key]!;
          const tone = nodeTone(n);
          const restricted = n.visibility === "restricted";
          return (
            <a
              key={n.key}
              href={`/history/${encodeURIComponent(n.key)}`}
              data-tone={tone}
              aria-label={restricted ? `${n.key} (restricted)` : `${n.key} ${n.title}`}
              onClick={(e) => dragged.current && e.preventDefault()}
              onMouseEnter={() => setHovered(n.key)}
              onMouseLeave={() => setHovered(null)}
              className={`absolute flex flex-col justify-between overflow-hidden rounded border border-l-4 border-zinc-200 bg-white p-2 shadow-sm hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900 ${TONE_BORDER[tone]}`}
              style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-medium ${TYPE_CHIP[n.issueType] ?? "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>{n.issueType}</span>
                <span className="font-mono text-zinc-500">{n.key}</span>
                {!restricted && n.assignee && <span className="ml-auto truncate text-zinc-500">{n.assignee}</span>}
              </div>
              {restricted ? <div className="text-sm italic text-zinc-500">🔒 Restricted ticket</div> : <div className="line-clamp-2 text-sm font-medium leading-tight">{n.title}</div>}
            </a>
          );
        })}
      </div>

      <div className="absolute right-2 top-2 flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
        <label className="flex items-center gap-1 rounded border border-zinc-300 bg-white/90 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900/90">
          <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />
          Show links
        </label>
        <button type="button" aria-label="Zoom out" className={btn} onClick={() => zoomBy(1 / 1.2)}>
          −
        </button>
        <button type="button" aria-label="Zoom in" className={btn} onClick={() => zoomBy(1.2)}>
          +
        </button>
        <button type="button" aria-label="Fit to screen" className={btn} onClick={fit}>
          Fit
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-4 gap-y-1 rounded bg-white/90 p-2 text-xs text-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-400" aria-label="Legend">
        {[
          ["bg-green-500", "High confidence"],
          ["bg-amber-500", "Medium"],
          ["bg-red-500", "Low / rejected"],
          ["bg-zinc-400", "Not summarized"],
          ["bg-zinc-500", "Restricted (locked)"],
        ].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className={`inline-block h-3 w-1 ${c}`} /> {l}
          </span>
        ))}
        <span>— parent/child</span>
        <span>- - link (red = blocks)</span>
      </div>
    </div>
  );
}
