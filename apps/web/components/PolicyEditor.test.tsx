// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolicyEditor } from "./PolicyEditor";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("PolicyEditor", () => {
  it("warns that everything is restricted when there are no rules", () => {
    render(<PolicyEditor projectKey="HND" initialRules={[]} />);
    expect(document.body.textContent).toMatch(/restricted/i);
    expect(screen.queryAllByLabelText("Label")).toHaveLength(0);
  });

  it("renders existing rules, project-wide rule with a blank label", () => {
    render(<PolicyEditor projectKey="HND" initialRules={[{ label: null, visibility: "readable" }, { label: "hr-confidential", visibility: "restricted" }]} />);
    const labels = screen.getAllByLabelText("Label") as HTMLInputElement[];
    expect(labels.map((l) => l.value)).toEqual(["", "hr-confidential"]);
    const vis = screen.getAllByLabelText("Visibility") as HTMLSelectElement[];
    expect(vis.map((v) => v.value)).toEqual(["readable", "restricted"]);
  });

  it("adds and removes rules", () => {
    render(<PolicyEditor projectKey="HND" initialRules={[]} />);
    fireEvent.click(screen.getByText("Add rule"));
    fireEvent.click(screen.getByText("Add rule"));
    expect(screen.getAllByLabelText("Label")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("Remove rule")[0]!);
    expect(screen.getAllByLabelText("Label")).toHaveLength(1);
  });

  it("saves with PUT through the proxy using the CSRF header and tells the user about the re-ingest", async () => {
    fetchMock.mockResolvedValue(ok({ rules: [], reingestJobId: "ingest-1" }));
    render(<PolicyEditor projectKey="HND" initialRules={[{ label: null, visibility: "readable" }]} />);
    fireEvent.click(screen.getByText("Add rule"));
    const labels = screen.getAllByLabelText("Label");
    fireEvent.change(labels[1]!, { target: { value: " hr-confidential " } });
    fireEvent.change(screen.getAllByLabelText("Visibility")[1]!, { target: { value: "restricted" } });
    fireEvent.click(screen.getByText("Save rules"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/projects/HND/rules");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["x-requested-with"]).toBe("handover");
    expect(JSON.parse(init.body as string)).toEqual({
      rules: [
        { label: null, visibility: "readable" },
        { label: "hr-confidential", visibility: "restricted" },
      ],
    });
    await waitFor(() => expect(document.body.textContent).toMatch(/saved/i));
    expect(document.body.textContent).toMatch(/re-?ingest/i);
  });

  it("does not call the API when rules are invalid", () => {
    render(<PolicyEditor projectKey="HND" initialRules={[{ label: "x", visibility: "readable" }, { label: "X", visibility: "restricted" }]} />);
    fireEvent.click(screen.getByText("Save rules"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toMatch(/duplicate/i);
  });

  it("shows an error and keeps the draft when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    render(<PolicyEditor projectKey="HND" initialRules={[{ label: "a", visibility: "restricted" }]} />);
    fireEvent.click(screen.getByText("Save rules"));
    await waitFor(() => expect(document.body.textContent).toMatch(/could not save/i));
    expect((screen.getAllByLabelText("Label")[0] as HTMLInputElement).value).toBe("a");
  });
});
