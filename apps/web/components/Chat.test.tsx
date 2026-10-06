// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./Chat";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const answered = (o: Record<string, unknown> = {}) =>
  json(200, {
    sessionId: "s1",
    message: {
      id: "m1",
      role: "assistant",
      status: "answered",
      content: "The Redis cache was rejected because invalidation is risky [HND-1]. Also see [HND-99].",
      confidence: "high",
      citations: [{ ticket: "HND-1", title: "Checkout times out", url: "https://x/browse/HND-1", quote: "cache invalidation on price changes is risky" }],
      sources: [{ key: "HND-1", title: "Checkout times out", url: "https://x/browse/HND-1" }],
      createdAt: new Date().toISOString(),
      ...o,
    },
  });

const input = () => screen.getByLabelText("Your question") as HTMLTextAreaElement;
const ask = (q: string) => {
  fireEvent.change(input(), { target: { value: q } });
  fireEvent.click(screen.getByText("Ask"));
};

describe("Chat", () => {
  it("shows suggested questions when empty, and asking one sends it", async () => {
    fetchMock.mockResolvedValue(answered());
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    const first = screen.getAllByRole("button").find((b) => b.getAttribute("data-suggestion") !== null)!;
    fireEvent.click(first);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string).message).toBe(first.textContent);
  });

  it("posts the question through the proxy with the CSRF header and shows the answer", async () => {
    fetchMock.mockResolvedValue(answered());
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("Why was Redis rejected?");
    await waitFor(() => expect(document.body.textContent).toContain("The Redis cache was rejected"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/chat");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-requested-with"]).toBe("handover");
    expect(JSON.parse(init.body as string)).toEqual({ message: "Why was Redis rejected?" });
    expect(document.body.textContent).toContain("Why was Redis rejected?");
    expect(input().value).toBe("");
  });

  it("links [KEY] markers only for tickets that were actually sources", async () => {
    fetchMock.mockResolvedValue(answered());
    const { container } = render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("q one");
    await waitFor(() => expect(container.textContent).toContain("Also see [HND-99]"));
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/history/HND-1");
    expect(hrefs).not.toContain("/history/HND-99");
  });

  it("shows each citation as a quote with a link to its ticket", async () => {
    fetchMock.mockResolvedValue(answered());
    const { container } = render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("q one");
    await waitFor(() => expect(container.querySelector("blockquote")).not.toBeNull());
    expect(container.querySelector("blockquote")!.textContent).toBe("cache invalidation on price changes is risky");
    expect([...container.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/history/HND-1" && a.textContent!.includes("Checkout times out"))).toBe(true);
    expect(container.textContent).toMatch(/high confidence/i);
  });

  it("continues the same session on the next question", async () => {
    fetchMock.mockResolvedValueOnce(answered()).mockResolvedValueOnce(answered({ id: "m2" }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("first question");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByText("Ask") as HTMLButtonElement).disabled).toBe(false));
    ask("and why?");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string)).toEqual({ message: "and why?", sessionId: "s1" });
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", "/ask?s=s1");
  });

  it("explains when nothing relevant was found and when an answer was withheld", async () => {
    fetchMock.mockResolvedValueOnce(answered({ status: "no_sources", content: "I couldn't find anything about that.", citations: [], sources: [], confidence: null }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("kubernetes");
    await waitFor(() => expect(document.body.textContent).toContain("I couldn't find anything about that."));
    expect(document.body.textContent).toMatch(/no matching tickets/i);

    cleanup();
    fetchMock.mockResolvedValueOnce(answered({ status: "rejected", content: "I couldn't produce an answer I could back.", citations: [], confidence: null }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("hmm");
    await waitFor(() => expect(document.body.textContent).toContain("I couldn't produce an answer I could back."));
    expect(document.body.textContent).toMatch(/withheld/i);
    expect(document.body.textContent).toContain("Related tickets");
  });

  it("shows an error and keeps the question when the request fails", async () => {
    fetchMock.mockResolvedValue(json(502, { error: "The AI service failed. Please try again." }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("will fail");
    await waitFor(() => expect(document.body.textContent).toContain("The AI service failed. Please try again."));
    expect(input().value).toBe("will fail");
  });

  it("renders model text as text, never as HTML", async () => {
    fetchMock.mockResolvedValue(answered({ content: '<img src=x onerror="alert(1)"> <b>bold</b>' }));
    const { container } = render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("xss");
    await waitFor(() => expect(container.textContent).toContain("<b>bold</b>"));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("ignores empty questions and sends on Enter but not Shift+Enter", async () => {
    fetchMock.mockResolvedValue(answered());
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("   ");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(input(), { target: { value: "multi" } });
    fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("restores an existing conversation", () => {
    render(
      <Chat
        initialSessionId="s9"
        initialMessages={[
          { id: "1", role: "user", content: "old question" },
          { id: "2", role: "assistant", content: "old answer [HND-1]", status: "answered", citations: [], sources: [{ key: "HND-1", title: "T", url: "u" }], confidence: "low" },
        ]}
      />,
    );
    expect(document.body.textContent).toContain("old question");
    expect(document.body.textContent).toContain("old answer");
  });
});

describe("Chat suggestions and prefill", () => {
  it("shows the suggestions it is given", () => {
    render(<Chat initialSessionId={null} initialMessages={[]} suggestions={["Why did we choose Elasticsearch?", "Who fixed the duplicate charges?"]} />);
    const labels = screen.getAllByRole("button").filter((b) => b.getAttribute("data-suggestion") !== null).map((b) => b.textContent);
    expect(labels).toEqual(["Why did we choose Elasticsearch?", "Who fixed the duplicate charges?"]);
  });

  it("pre-fills the question box from a link but never sends it automatically", () => {
    render(<Chat initialSessionId={null} initialMessages={[]} initialInput="Why did we reject Algolia?" />);
    expect((screen.getByLabelText("Your question") as HTMLTextAreaElement).value).toBe("Why did we reject Algolia?");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Chat overview note", () => {
  it("explains that a broad answer is based on a sample, and only then", async () => {
    fetchMock.mockResolvedValueOnce(answered({ scope: "overview" }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("what did we do?");
    await waitFor(() => expect(document.body.textContent).toMatch(/overview/i));
    expect(document.body.textContent).toMatch(/specific topic/i);

    cleanup();
    fetchMock.mockResolvedValueOnce(answered({ scope: "search" }));
    render(<Chat initialSessionId={null} initialMessages={[]} />);
    ask("why redis?");
    await waitFor(() => expect(document.body.textContent).toContain("The Redis cache was rejected"));
    expect(document.body.textContent).not.toMatch(/specific topic/i);
  });
});
