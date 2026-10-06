import { describe, expect, it, vi } from "vitest";
import { JiraConnector } from "./connector";
import { JiraClient } from "./client";

const adf = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const issue = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  fields: {
    summary: `Title ${key}`,
    status: { name: "Done" },
    labels: ["backend"],
    description: adf("desc " + key),
    updated: "2024-01-01T00:00:00.000+0000",
    issuetype: { name: "Story" },
    parent: { key: "X-100" },
    assignee: { displayName: "Dana" },
    comment: { total: 1, comments: [{ author: { displayName: "Dana" }, created: "c1", body: adf("a comment") }] },
    issuelinks: [
      { type: { outward: "blocks", inward: "is blocked by" }, outwardIssue: { key: "X-9" } },
      { type: { outward: "blocks", inward: "is blocked by" }, inwardIssue: { key: "X-8" } },
    ],
    ...extra,
  },
  changelog: { total: 1, histories: [{ author: { displayName: "Dana" }, created: "h1", items: [{ field: "status", fromString: "To Do", toString: "Done" }] }] },
});

const fakeClient = (handler: (path: string, params?: Record<string, unknown>) => unknown) =>
  ({ baseUrl: "https://x.atlassian.net", get: vi.fn(async (p: string, q?: Record<string, unknown>) => handler(p, q)) }) as unknown as JiraClient;

describe("JiraConnector", () => {
  it("normalizes issues and paginates with nextPageToken", async () => {
    const client = fakeClient((_p, q) => (q?.nextPageToken ? { issues: [issue("X-2")] } : { issues: [issue("X-1")], nextPageToken: "tok2" }));
    const c = new JiraConnector(client);
    const p1 = await c.fetchIssues("X");
    expect(p1.nextCursor).toBe("tok2");
    const t = p1.tickets[0]!;
    expect(t).toMatchObject({
      key: "X-1",
      project: "X",
      url: "https://x.atlassian.net/browse/X-1",
      title: "Title X-1",
      status: "Done",
      labels: ["backend"],
      description: "desc X-1",
      issueType: "Story",
      parent: "X-100",
      assignee: "Dana",
    });
    expect(t.comments).toEqual([{ author: "Dana", created: "c1", body: "a comment" }]);
    expect(t.changelog).toEqual([{ author: "Dana", created: "h1", field: "status", from: "To Do", to: "Done" }]);
    expect(t.links).toEqual([
      { type: "blocks", key: "X-9" },
      { type: "is blocked by", key: "X-8" },
    ]);
    const p2 = await c.fetchIssues("X", p1.nextCursor);
    expect(p2.nextCursor).toBeNull();
    expect(p2.tickets[0]!.key).toBe("X-2");
  });
  it("defaults to Task, no parent and no assignee when Jira omits them", async () => {
    const client = fakeClient(() => ({ issues: [issue("X-3", { issuetype: undefined, parent: undefined, assignee: null })] }));
    const t = (await new JiraConnector(client).fetchIssues("X")).tickets[0]!;
    expect(t).toMatchObject({ issueType: "Task", parent: null, assignee: null });
  });
  it("asks Jira for the hierarchy fields", async () => {
    const client = fakeClient(() => ({ issues: [] }));
    await new JiraConnector(client).fetchIssues("X");
    const q = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
    for (const f of ["parent", "issuetype", "assignee"]) expect(q.fields).toContain(f);
  });
  it("orders by updated and scopes the JQL to the project", async () => {
    const client = fakeClient(() => ({ issues: [] }));
    await new JiraConnector(client).fetchIssues("ABC");
    const q = (client.get as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Record<string, string>;
    expect(q.jql).toBe('project = "ABC" ORDER BY updated ASC');
  });
  it("fetches remaining comments and changelog when the search response is truncated", async () => {
    const truncated = issue("X-1", { comment: { total: 2, comments: [{ author: { displayName: "A" }, created: "c1", body: adf("one") }] } });
    (truncated.changelog as { total: number }).total = 2;
    const client = fakeClient((p) => {
      if (p.includes("/search/jql")) return { issues: [truncated] };
      if (p.endsWith("/comment"))
        return {
          total: 2,
          comments: [
            { author: { displayName: "A" }, created: "c1", body: adf("one") },
            { author: { displayName: "B" }, created: "c2", body: adf("two") },
          ],
        };
      if (p.endsWith("/changelog"))
        return {
          isLast: true,
          values: [
            {
              author: { displayName: "A" },
              created: "h1",
              items: [
                { field: "status", fromString: "a", toString: "b" },
                { field: "assignee", fromString: null, toString: "Bob" },
              ],
            },
          ],
        };
      throw new Error("unexpected " + p);
    });
    const { tickets } = await new JiraConnector(client).fetchIssues("X");
    expect(tickets[0]!.comments.map((c) => c.body)).toEqual(["one", "two"]);
    expect(tickets[0]!.changelog).toHaveLength(2);
  });
  it("lists projects across pages", async () => {
    const client = fakeClient((_p, q) =>
      q?.startAt ? { isLast: true, values: [{ key: "B", name: "Bee" }] } : { isLast: false, values: [{ key: "A", name: "Ay" }] },
    );
    expect(await new JiraConnector(client).listProjects()).toEqual([
      { key: "A", name: "Ay" },
      { key: "B", name: "Bee" },
    ]);
  });
});
