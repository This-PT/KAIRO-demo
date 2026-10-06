import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedTicket } from "@handover/core";
import { FixtureConnector } from "./fixtures";

const dir = join(__dirname, "../../../fixtures/showcase");
const all = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => NormalizedTicket.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
const byKey = new Map(all.map((t) => [t.key, t]));

describe("showcase connector", () => {
  const c = FixtureConnector.showcase();
  it("exposes the Shopfront project and leaves the default fixtures alone", async () => {
    expect(await c.listProjects()).toEqual([{ key: "SHOP", name: "Shopfront" }]);
    expect(await new FixtureConnector().listProjects()).toEqual([{ key: "HND", name: "Handover Demo" }]);
  });
  it("pages through every ticket", async () => {
    const p1 = await c.fetchIssues("SHOP", null, 10);
    expect(p1.tickets).toHaveLength(10);
    const p2 = await c.fetchIssues("SHOP", p1.nextCursor, 10);
    const p3 = await c.fetchIssues("SHOP", p2.nextCursor, 10);
    expect(p3.nextCursor).toBeNull();
    expect(p1.tickets.length + p2.tickets.length + p3.tickets.length).toBe(all.length);
  });
  it("returns nothing for other projects", async () => expect((await c.fetchIssues("HND")).tickets).toEqual([]));
});

describe("showcase dataset", () => {
  it("is big enough to demo, with unique keys", () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    expect(new Set(all.map((t) => t.key)).size).toBe(all.length);
    expect(all.every((t) => t.project === "SHOP")).toBe(true);
  });
  it("has epics, a real hierarchy and no dangling parents", () => {
    expect(all.filter((t) => t.issueType === "Epic").length).toBeGreaterThanOrEqual(3);
    expect(all.some((t) => t.issueType === "Sub-task" && t.parent && byKey.get(t.parent)?.parent)).toBe(true);
    for (const t of all) if (t.parent) expect(byKey.has(t.parent), `${t.key} -> ${t.parent}`).toBe(true);
  });
  it("involves several people", () => expect(new Set(all.map((t) => t.assignee)).size).toBeGreaterThanOrEqual(4));
  it("has links between tickets, all pointing at tickets that exist", () => {
    const links = all.flatMap((t) => t.links);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const l of links) expect(byKey.has(l.key), l.key).toBe(true);
  });
  it("has exactly the restricted tickets the policy demo needs", () => {
    expect(all.filter((t) => t.labels.includes("hr-confidential")).map((t) => t.key).sort()).toEqual(["SHOP-21", "SHOP-22"]);
  });
  it("includes decisions, rejected options and gotchas for the chat to find", () => {
    const text = all.map((t) => [t.description, ...t.comments.map((c) => c.body)].join(" ")).join(" ").toLowerCase();
    for (const w of ["we rejected", "gotcha", "root cause", "chose"]) expect(text).toContain(w);
  });
  it("includes a leaked-secret example, an injection example, and thin tickets (to show confidence)", () => {
    const body = (k: string) => [byKey.get(k)!.description, ...byKey.get(k)!.comments.map((c) => c.body)].join(" ");
    expect(body("SHOP-9")).toMatch(/sk_live_/);
    expect(body("SHOP-9")).toMatch(/@shopfront\.example/);
    expect(body("SHOP-25")).toMatch(/ignore all previous instructions/i);
    expect(byKey.get("SHOP-24")!.comments).toHaveLength(1);
  });
  it("has no real-looking contact details", () => {
    expect(JSON.stringify(all)).not.toMatch(/@gmail\.|@outlook\.|@yahoo\./i);
  });
});
