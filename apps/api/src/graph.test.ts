import { describe, expect, it } from "vitest";
import { buildGraph, type GraphLink, type GraphTicket } from "./graph";

const t = (key: string, o: Partial<GraphTicket> = {}): GraphTicket => ({
  key,
  project: "P",
  title: `Title ${key}`,
  issueType: "Task",
  status: "Done",
  visibility: "readable",
  parentKey: null,
  assignee: null,
  labels: [],
  url: `https://x/browse/${key}`,
  summary: { status: "ok", confidence: "high" },
  ...o,
});
const restricted = (key: string, o: Partial<GraphTicket> = {}) => t(key, { visibility: "restricted", title: "[Restricted]", status: "restricted", summary: null, ...o });
const keys = (g: { nodes: { key: string }[] }) => g.nodes.map((n) => n.key).sort();

describe("buildGraph nodes", () => {
  it("maps readable tickets including parent, assignee, labels and summary confidence", () => {
    const g = buildGraph([t("A-1", { issueType: "Epic" }), t("A-2", { parentKey: "A-1", assignee: "Dana", labels: ["x"] })], [], {});
    expect(g.nodes.find((n) => n.key === "A-2")).toMatchObject({ title: "Title A-2", parent: "A-1", assignee: "Dana", labels: ["x"], summary: { status: "ok", confidence: "high" }, visibility: "readable" });
  });

  it("masks restricted tickets even if the input carries real data", () => {
    const leaky = t("A-9", { visibility: "restricted", title: "Salary bands", status: "Done", assignee: "HR", labels: ["hr-confidential"], summary: { status: "ok", confidence: "high" } });
    const n = buildGraph([leaky], [], {}).nodes[0]!;
    expect(n).toMatchObject({ title: "[Restricted]", status: "restricted", assignee: null, labels: [], summary: null, visibility: "restricted" });
    expect(JSON.stringify(n)).not.toMatch(/Salary|HR|hr-confidential/);
  });

  it("keeps the tree shape: a restricted ticket can have a parent and children", () => {
    const g = buildGraph([t("A-1", { issueType: "Epic" }), restricted("A-2", { parentKey: "A-1" }), t("A-3", { parentKey: "A-2" })], [], {});
    expect(g.nodes.find((n) => n.key === "A-2")!.parent).toBe("A-1");
    expect(g.nodes.find((n) => n.key === "A-3")!.parent).toBe("A-2");
  });

  it("drops a parent that is not in the graph instead of dangling", () => {
    expect(buildGraph([t("A-1", { parentKey: "OTHER-1" })], [], {}).nodes[0]!.parent).toBeNull();
  });

  it("a ticket cannot be its own parent", () => {
    expect(buildGraph([t("A-1", { parentKey: "A-1" })], [], {}).nodes[0]!.parent).toBeNull();
  });
});

describe("buildGraph edges", () => {
  const tickets = [t("A-1"), t("A-2"), restricted("A-3")];
  it("keeps link edges between known tickets, including to restricted ones", () => {
    const links: GraphLink[] = [
      { from: "A-1", to: "A-2", type: "blocks" },
      { from: "A-1", to: "A-3", type: "relates to" },
    ];
    expect(buildGraph(tickets, links, {}).edges).toEqual([
      { from: "A-1", to: "A-2", type: "blocks" },
      { from: "A-1", to: "A-3", type: "relates to" },
    ]);
  });
  it("drops links to tickets that are not in the graph", () => {
    expect(buildGraph(tickets, [{ from: "A-1", to: "NOPE-1", type: "blocks" }], {}).edges).toEqual([]);
  });
  it("collapses the same relationship reported from both ends", () => {
    const links: GraphLink[] = [
      { from: "A-1", to: "A-2", type: "relates to" },
      { from: "A-2", to: "A-1", type: "relates to" },
    ];
    expect(buildGraph(tickets, links, {}).edges).toHaveLength(1);
  });
  it("keeps different relationship types between the same pair", () => {
    const links: GraphLink[] = [
      { from: "A-1", to: "A-2", type: "blocks" },
      { from: "A-1", to: "A-2", type: "relates to" },
    ];
    expect(buildGraph(tickets, links, {}).edges).toHaveLength(2);
  });
});

describe("buildGraph filters", () => {
  const epic = t("E-1", { issueType: "Epic", labels: ["epic"] });
  const story = t("S-1", { parentKey: "E-1", labels: ["auth"], assignee: "Mia" });
  const sub = t("T-1", { parentKey: "S-1", labels: ["bug"], assignee: "Raj" });
  const other = t("O-1", { project: "Q", labels: ["auth"], assignee: "Mia" });
  const hidden = restricted("R-1", { parentKey: "E-1" });
  const all = [epic, story, sub, other, hidden];

  it("returns everything with no filters", () => expect(keys(buildGraph(all, [], {}))).toEqual(["E-1", "O-1", "R-1", "S-1", "T-1"]));

  it("filters by project", () => expect(keys(buildGraph(all, [], { project: "Q" }))).toEqual(["O-1"]));

  it("filters by label and keeps the ancestors so the path stays visible", () => {
    expect(keys(buildGraph(all, [], { label: "bug" }))).toEqual(["E-1", "S-1", "T-1"]);
  });

  it("filters by person (case-insensitive) with ancestors", () => {
    expect(keys(buildGraph(all, [], { person: "raj" }))).toEqual(["E-1", "S-1", "T-1"]);
  });

  it("does not match restricted tickets by label or person, but may include them as ancestors", () => {
    const g = buildGraph([restricted("R-2", { labels: ["auth"], assignee: "Mia" }), t("C-1", { parentKey: "R-2", labels: ["auth"] })], [], { label: "auth" });
    expect(keys(g)).toEqual(["C-1", "R-2"]);
    expect(g.nodes.find((n) => n.key === "R-2")!.title).toBe("[Restricted]");
    expect(buildGraph([restricted("R-2", { labels: ["auth"] })], [], { label: "auth" }).nodes).toEqual([]);
  });

  it("drops edges whose ends were filtered out", () => {
    const g = buildGraph(all, [{ from: "T-1", to: "O-1", type: "relates to" }], { project: "Q" });
    expect(g.edges).toEqual([]);
  });

  it("terminates on parent cycles and still returns the nodes", () => {
    const a = t("C-1", { parentKey: "C-2", labels: ["x"] });
    const b = t("C-2", { parentKey: "C-1" });
    const g = buildGraph([a, b], [], { label: "x" });
    expect(keys(g)).toEqual(["C-1", "C-2"]);
  });
});

describe("buildGraph link direction", () => {
  const tickets = [t("A-1"), t("A-2")];
  it("turns 'is blocked by' into the equivalent 'blocks' edge pointing the other way", () => {
    expect(buildGraph(tickets, [{ from: "A-2", to: "A-1", type: "is blocked by" }], {}).edges).toEqual([{ from: "A-1", to: "A-2", type: "blocks" }]);
  });
  it("shows one arrow when Jira reports the same relationship from both ends", () => {
    const links: GraphLink[] = [
      { from: "A-1", to: "A-2", type: "blocks" },
      { from: "A-2", to: "A-1", type: "is blocked by" },
    ];
    expect(buildGraph(tickets, links, {}).edges).toEqual([{ from: "A-1", to: "A-2", type: "blocks" }]);
  });
  it("keeps opposite directions of a directional link distinct", () => {
    const links: GraphLink[] = [
      { from: "A-1", to: "A-2", type: "blocks" },
      { from: "A-2", to: "A-1", type: "blocks" },
    ];
    expect(buildGraph(tickets, links, {}).edges).toHaveLength(2);
  });
});
