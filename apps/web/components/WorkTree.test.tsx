// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "@/lib/api";
import { WorkTree } from "./WorkTree";

afterEach(cleanup);

const node = (key: string, o: Partial<GraphNode> = {}): GraphNode => ({
  key,
  project: "HND",
  title: `Title ${key}`,
  issueType: "Task",
  status: "Done",
  visibility: "readable",
  parent: null,
  assignee: null,
  labels: [],
  url: `https://fake/${key}`,
  summary: { status: "ok", confidence: "high" },
  ...o,
});
const nodes: GraphNode[] = [
  node("E-1", { issueType: "Epic" }),
  node("S-1", { parent: "E-1", assignee: "Mia Torres", summary: { status: "ok", confidence: "low" } }),
  node("R-1", { parent: "E-1", visibility: "restricted", title: "[Restricted]", status: "restricted", summary: null }),
  node("T-1", { parent: "S-1", summary: null }),
];
const edges: GraphEdge[] = [{ from: "S-1", to: "T-1", type: "blocks" }];

describe("WorkTree", () => {
  it("renders every ticket as a link to its page", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    for (const k of ["E-1", "S-1", "R-1", "T-1"]) expect(hrefs).toContain(`/history/${k}`);
  });

  it("shows titles, issue types and assignees for readable tickets", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    expect(container.textContent).toContain("Title S-1");
    expect(container.textContent).toContain("Epic");
    expect(container.textContent).toContain("Mia Torres");
  });

  it("shows restricted tickets as locked placeholders without any content", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    const a = container.querySelector('a[href="/history/R-1"]')!;
    expect(a.textContent).toContain("Restricted");
    expect(a.textContent).not.toContain("Title R-1");
    expect(a.getAttribute("data-tone")).toBe("locked");
  });

  it("encodes confidence as a tone on each node", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    expect(container.querySelector('a[href="/history/E-1"]')!.getAttribute("data-tone")).toBe("good");
    expect(container.querySelector('a[href="/history/S-1"]')!.getAttribute("data-tone")).toBe("bad");
    expect(container.querySelector('a[href="/history/T-1"]')!.getAttribute("data-tone")).toBe("none");
  });

  it("draws hierarchy lines and optional link lines that can be toggled", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    expect(container.querySelectorAll("path[data-kind=parent]")).toHaveLength(3);
    expect(container.querySelectorAll("path[data-kind=link]")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("Show links"));
    expect(container.querySelectorAll("path[data-kind=link]")).toHaveLength(0);
    expect(container.querySelectorAll("path[data-kind=parent]")).toHaveLength(3);
  });

  it("zoom buttons change the view scale", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    const scale = () => Number(/scale\(([\d.]+)\)/.exec((container.querySelector("[data-testid=canvas]") as HTMLElement).style.transform)![1]);
    const before = scale();
    fireEvent.click(screen.getByLabelText("Zoom in"));
    expect(scale()).toBeGreaterThan(before);
    fireEvent.click(screen.getByLabelText("Zoom out"));
    fireEvent.click(screen.getByLabelText("Zoom out"));
    expect(scale()).toBeLessThan(before);
  });

  it("renders text safely", () => {
    const evil = [node("X-1", { title: '<img src=x onerror="alert(1)">', assignee: "<b>x</b>" })];
    const { container } = render(<WorkTree nodes={evil} edges={[]} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("explains an empty graph", () => {
    const { container } = render(<WorkTree nodes={[]} edges={[]} />);
    expect(container.textContent).toMatch(/no tickets/i);
  });

  it("includes a legend", () => {
    const { container } = render(<WorkTree nodes={nodes} edges={edges} />);
    expect(container.textContent).toMatch(/high confidence/i);
    expect(container.textContent).toMatch(/restricted/i);
  });
});
