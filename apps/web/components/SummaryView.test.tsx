// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Summary } from "@kairo/core";
import { SourceLink } from "./SourceLink";
import { SourceText } from "./SourceText";
import { SummaryView } from "./SummaryView";

afterEach(cleanup);

const base: Summary = {
  ticket: "HND-1",
  problem: "Checkout returned 504 under load.",
  root_cause: "N+1 queries in OrderRepository.",
  actions: [{ what: "Batched the lookup.", source: "comment by Dana Kim" }],
  rationale: "",
  rejected_options: [{ option: "Redis cache", why_rejected: "Invalidation is risky." }],
  gotchas: ["Keep the batch under 1000 ids."],
  people: ["Dana Kim"],
  related: ["HND-4"],
  evidence: [
    { field: "problem", quote: "Checkout API returns 504" },
    { field: "gotchas", quote: "must stay under 1000 ids" },
  ],
  confidence: "medium",
  missing: ["rationale"],
};

describe("SummaryView", () => {
  it("renders every non-empty section", () => {
    const { container } = render(<SummaryView summary={base} />);
    const t = container.textContent!;
    for (const s of ["Checkout returned 504 under load.", "N+1 queries in OrderRepository.", "Batched the lookup.", "comment by Dana Kim", "Redis cache", "Invalidation is risky.", "Keep the batch under 1000 ids.", "Dana Kim", "HND-4"]) {
      expect(t).toContain(s);
    }
  });

  it("does not render empty sections but lists them as not stated in the ticket", () => {
    const { container } = render(<SummaryView summary={base} />);
    const headings = [...container.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).not.toContain("Rationale");
    expect(container.textContent).toMatch(/not stated in the ticket/i);
    expect(container.querySelector("[data-testid=missing]")!.textContent).toContain("Rationale");
  });

  it("shows evidence quotes as blockquotes grouped under their field", () => {
    const { container } = render(<SummaryView summary={base} />);
    const quotes = [...container.querySelectorAll("blockquote")].map((q) => q.textContent);
    expect(quotes).toEqual(["Checkout API returns 504", "must stay under 1000 ids"]);
  });

  it("renders untrusted text as text, never as HTML", () => {
    const evil = { ...base, problem: '<img src=x onerror="alert(1)"><script>alert(2)</script>', gotchas: ["<b>bold</b>"] };
    const { container } = render(<SummaryView summary={evil} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("links related tickets inside the app, with the key URL-encoded", () => {
    const { container } = render(<SummaryView summary={{ ...base, related: ["HND-4", "../x?y"] }} />);
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/history/HND-4");
    expect(hrefs).toContain("/history/..%2Fx%3Fy");
  });
});

describe("SourceLink", () => {
  it("opens http(s) sources in a new tab without leaking the opener", () => {
    const { container } = render(<SourceLink url="https://x.atlassian.net/browse/A-1" label="A-1" />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://x.atlassian.net/browse/A-1");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });
  it("renders plain text, not a link, for unsafe URLs", () => {
    const { container } = render(<SourceLink url="javascript:alert(1)" label="A-1" />);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("A-1");
  });
});

describe("SourceLink in demo mode", () => {
  it("points to the in-app source text instead of the non-existent external URL", () => {
    const { container } = render(<SourceLink url="https://fake.atlassian.net/browse/A-1" label="Source" demoHref="/history/A-1#source" />);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/history/A-1#source");
    expect(a.getAttribute("target")).toBeNull();
    expect(container.innerHTML).not.toContain("fake.atlassian.net");
  });
});

describe("SourceText", () => {
  it("shows the original text under the #source anchor, as plain text", () => {
    const { container } = render(<SourceText text={"[A-1] Title\n<img src=x onerror=alert(1)>"} />);
    expect(container.querySelector("#source")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
