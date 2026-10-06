import { describe, expect, it } from "vitest";
import { renderTicketText } from "./render";

describe("renderTicketText", () => {
  it("includes every field's text verbatim so evidence quotes can be matched", () => {
    const t = renderTicketText({
      key: "A-1",
      project: "A",
      url: "u",
      title: "My title",
      status: "Done",
      labels: ["x", "y"],
      description: "Some description",
      comments: [{ author: "Dana", created: "2024-01-01", body: "Rejected option B." }],
      changelog: [{ author: "Dana", created: "2024-01-02", field: "status", from: "To Do", to: "Done" }],
      links: [{ type: "blocks", key: "A-2" }],
      updated: "2024-01-02",
      issueType: "Task",
      parent: null,
      assignee: null,
    });
    for (const s of ["A-1", "My title", "Some description", "Rejected option B.", "Dana", "To Do", "Done", "blocks A-2", "x, y"]) {
      expect(t).toContain(s);
    }
  });
});
