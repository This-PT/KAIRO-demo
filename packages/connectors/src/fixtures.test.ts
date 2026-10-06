import { describe, expect, it } from "vitest";
import { FixtureConnector } from "./fixtures";

describe("FixtureConnector", () => {
  const c = new FixtureConnector();
  it("lists the HND project", async () => expect(await c.listProjects()).toEqual([{ key: "HND", name: "Kairo Demo" }]));
  it("returns all fixture tickets in pages", async () => {
    const p1 = await c.fetchIssues("HND", null, 5);
    expect(p1.tickets).toHaveLength(5);
    expect(p1.nextCursor).toBe("5");
    const p2 = await c.fetchIssues("HND", p1.nextCursor, 5);
    expect(p2.tickets).toHaveLength(5);
    expect(p2.nextCursor).toBeNull();
  });
  it("returns nothing for unknown projects", async () => expect((await c.fetchIssues("NOPE")).tickets).toEqual([]));
});
