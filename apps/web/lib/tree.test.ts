import { describe, expect, it } from "vitest";
import { COL_W, NODE_H, NODE_W, ROW_H, edgePath, fitView, layoutTree, nodeTone, zoomAt, type TreeNode } from "./tree";

const n = (key: string, parent: string | null = null, issueType = "Task"): TreeNode => ({ key, parent, issueType });
const pos = (nodes: TreeNode[]) => layoutTree(nodes).positions;

describe("layoutTree", () => {
  it("places a single node at the origin", () => {
    const l = layoutTree([n("A-1")]);
    expect(l.positions["A-1"]).toEqual({ x: 0, y: 0, depth: 0 });
    expect(l.width).toBe(NODE_W);
    expect(l.height).toBe(NODE_H);
  });

  it("puts children one column right and centres the parent between them", () => {
    const p = pos([n("A-1"), n("A-2", "A-1"), n("A-3", "A-1")]);
    expect(p["A-2"]).toEqual({ x: COL_W, y: 0, depth: 1 });
    expect(p["A-3"]).toEqual({ x: COL_W, y: ROW_H, depth: 1 });
    expect(p["A-1"]!.y).toBe(ROW_H / 2);
  });

  it("lays out three levels without overlaps", () => {
    const nodes = [n("E-1", null, "Epic"), n("S-1", "E-1"), n("S-2", "E-1"), n("T-1", "S-1"), n("T-2", "S-1"), n("T-3", "S-2")];
    const p = pos(nodes);
    const cells = Object.values(p).map((q) => `${q.x},${q.y}`);
    expect(new Set(cells).size).toBe(nodes.length);
    expect(p["T-1"]!.x).toBe(COL_W * 2);
    // leaves are at least one row apart
    const leafYs = ["T-1", "T-2", "T-3"].map((k) => p[k]!.y).sort((a, b) => a - b);
    expect(leafYs[1]! - leafYs[0]!).toBeGreaterThanOrEqual(ROW_H);
    expect(leafYs[2]! - leafYs[1]!).toBeGreaterThanOrEqual(ROW_H);
  });

  it("stacks separate roots so their subtrees never overlap", () => {
    const p = pos([n("A-1"), n("A-2", "A-1"), n("A-3", "A-1"), n("B-1")]);
    expect(p["B-1"]!.y).toBeGreaterThanOrEqual(p["A-3"]!.y + ROW_H);
  });

  it("treats a node whose parent is missing as a root", () => {
    const p = pos([n("A-1", "GONE-1")]);
    expect(p["A-1"]).toMatchObject({ x: 0, depth: 0 });
  });

  it("terminates on parent cycles and still places every node", () => {
    const p = pos([n("A-1", "A-2"), n("A-2", "A-1"), n("A-3", "A-3")]);
    expect(Object.keys(p).sort()).toEqual(["A-1", "A-2", "A-3"]);
    for (const q of Object.values(p)) expect(Number.isFinite(q.x + q.y)).toBe(true);
  });

  it("orders epics first, then keys numerically (A-2 before A-10)", () => {
    const p = pos([n("A-1"), n("A-10", "A-1"), n("A-2", "A-1"), n("A-9", "A-1", "Epic")]);
    const order = ["A-9", "A-2", "A-10"].map((k) => p[k]!.y);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("is deterministic regardless of input order", () => {
    const nodes = [n("A-1"), n("A-2", "A-1"), n("A-3", "A-1"), n("B-1")];
    expect(layoutTree([...nodes].reverse()).positions).toEqual(layoutTree(nodes).positions);
  });

  it("reports bounds that contain every node", () => {
    const l = layoutTree([n("A-1"), n("A-2", "A-1"), n("A-3", "A-2")]);
    for (const q of Object.values(l.positions)) {
      expect(q.x + NODE_W).toBeLessThanOrEqual(l.width);
      expect(q.y + NODE_H).toBeLessThanOrEqual(l.height);
    }
  });

  it("returns empty bounds for no nodes", () => expect(layoutTree([])).toEqual({ positions: {}, width: 0, height: 0 }));
});

describe("edgePath", () => {
  it("draws a smooth curve from the right edge of the source to the left edge of the target", () => {
    const d = edgePath({ x: 0, y: 0 }, { x: COL_W, y: ROW_H });
    expect(d.startsWith(`M ${NODE_W} ${NODE_H / 2}`)).toBe(true);
    expect(d).toContain(" C ");
    expect(d.endsWith(`${COL_W} ${ROW_H + NODE_H / 2}`)).toBe(true);
  });
  it("connects right-to-left when the target is to the left", () => {
    const d = edgePath({ x: COL_W, y: 0 }, { x: 0, y: 0 });
    expect(d.startsWith(`M ${COL_W} ${NODE_H / 2}`)).toBe(true);
    expect(d.endsWith(`${NODE_W} ${NODE_H / 2}`)).toBe(true);
  });
  it("never produces NaN", () => expect(edgePath({ x: 0, y: 0 }, { x: 0, y: 0 })).not.toContain("NaN"));
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const v = zoomAt({ x: 10, y: 20, k: 1 }, 2, 100, 50);
    expect(v.k).toBe(2);
    // world point under cursor before and after
    expect((100 - 10) / 1).toBeCloseTo((100 - v.x) / v.k);
    expect((50 - 20) / 1).toBeCloseTo((50 - v.y) / v.k);
  });
  it("clamps zoom between 0.2 and 2.5", () => {
    expect(zoomAt({ x: 0, y: 0, k: 2.4 }, 10, 0, 0).k).toBe(2.5);
    expect(zoomAt({ x: 0, y: 0, k: 0.25 }, 0.01, 0, 0).k).toBe(0.2);
  });
});

describe("fitView", () => {
  it("scales down to fit and centres the content", () => {
    const v = fitView({ width: 2000, height: 1000 }, { width: 1000, height: 500 });
    expect(v.k).toBeLessThan(0.5);
    expect(v.x).toBeGreaterThanOrEqual(0);
    expect(2000 * v.k + 2 * v.x).toBeCloseTo(1000);
  });
  it("never zooms in beyond 1", () => expect(fitView({ width: 100, height: 100 }, { width: 1000, height: 1000 }).k).toBe(1));
  it("handles empty content", () => expect(fitView({ width: 0, height: 0 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, k: 1 }));
});

describe("nodeTone", () => {
  it("colours by summary confidence", () => {
    expect(nodeTone({ visibility: "readable", summary: { status: "ok", confidence: "high" } })).toBe("good");
    expect(nodeTone({ visibility: "readable", summary: { status: "ok", confidence: "medium" } })).toBe("warn");
    expect(nodeTone({ visibility: "readable", summary: { status: "ok", confidence: "low" } })).toBe("bad");
  });
  it("marks rejected, missing and restricted separately", () => {
    expect(nodeTone({ visibility: "readable", summary: { status: "rejected", confidence: "low" } })).toBe("bad");
    expect(nodeTone({ visibility: "readable", summary: null })).toBe("none");
    expect(nodeTone({ visibility: "restricted", summary: null })).toBe("locked");
  });
});

describe("fitView with a minimum readable scale", () => {
  it("never shrinks below the minimum, even for a tall tree", () => {
    const v = fitView({ width: 900, height: 4000 }, { width: 1000, height: 600 }, 40, 0.55);
    expect(v.k).toBe(0.55);
  });
  it("anchors to the top-left when the content overflows, so the root and first tickets are readable", () => {
    const v = fitView({ width: 900, height: 4000 }, { width: 1000, height: 600 }, 40, 0.55);
    expect(v.y).toBe(40);
    expect(v.x).toBeGreaterThanOrEqual(0);
    const wide = fitView({ width: 4000, height: 300 }, { width: 1000, height: 600 }, 40, 0.55);
    expect(wide.x).toBe(40);
  });
  it("still centres content that fits at the minimum scale", () => {
    const v = fitView({ width: 600, height: 300 }, { width: 1000, height: 600 }, 40, 0.55);
    expect(v.k).toBe(1);
    expect(v.x).toBe(200);
    expect(v.y).toBe(150);
  });
  it("keeps the old behaviour when no minimum is given", () => {
    expect(fitView({ width: 900, height: 4000 }, { width: 1000, height: 600 }).k).toBeLessThan(0.2 + 1e-9);
  });
});
