import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NormalizedTicket } from "./index";

const dir = join(__dirname, "../../../fixtures/jira");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const load = (f: string) => NormalizedTicket.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));

describe("fixtures", () => {
  it("has 5-10 tickets", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.length).toBeLessThanOrEqual(10);
  });
  it.each(files)("%s matches NormalizedTicket", (f) => {
    const parsed = NormalizedTicket.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    expect(parsed.success).toBe(true);
  });

  it("old-shape tickets without hierarchy fields still parse, with safe defaults", () => {
    const old = { key: "A-1", project: "A", url: "u", title: "t", status: "Done", labels: [], description: "", comments: [], changelog: [], links: [], updated: "x" };
    expect(NormalizedTicket.parse(old)).toMatchObject({ issueType: "Task", parent: null, assignee: null });
  });

  it("fixtures describe a 3-level hierarchy, orphans, and a restricted ticket", () => {
    const all = Object.fromEntries(files.map((f) => [load(f).key, load(f)]));
    expect(all["HND-9"]).toMatchObject({ issueType: "Epic", parent: null });
    expect(all["HND-10"]).toMatchObject({ issueType: "Epic", parent: null });
    expect(all["HND-1"]!.parent).toBe("HND-9");
    expect(all["HND-4"]).toMatchObject({ issueType: "Sub-task", parent: "HND-1" });
    expect(all["HND-3"]!.parent).toBe("HND-10");
    expect(all["HND-6"]!.parent).toBeNull();
    for (const t of Object.values(all)) {
      if (t.parent) expect(all[t.parent], `${t.key} parent exists`).toBeDefined();
    }
  });
});
