"use client";

import { useEffect, useRef, useState } from "react";
import { callApi } from "@/lib/client";
import { SUGGESTIONS, splitAnswer, type ChatMsg } from "@/lib/chat";
import { confidenceTone } from "@/lib/format";
import { Badge } from "./Badge";

type Assistant = Extract<ChatMsg, { role: "assistant" }>;

function Answer({ m }: { m: Assistant }) {
  const keys = new Set(m.sources.map((s) => s.key));
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap">
        {splitAnswer(m.content, keys).map((p, i) =>
          p.type === "key" ? (
            <a key={i} href={`/history/${encodeURIComponent(p.value)}`} className="font-mono text-sm text-blue-600 underline underline-offset-2 dark:text-blue-400">
              [{p.value}]
            </a>
          ) : (
            <span key={i}>{p.value}</span>
          ),
        )}
      </p>

      {m.scope === "overview" && m.status !== "no_sources" && <p className="text-xs text-zinc-500">Based on an overview of the project&apos;s epics and latest tickets. Ask about a specific topic for more detail.</p>}
      {m.status === "no_sources" && <p className="text-xs text-zinc-500">No matching tickets were found, so nothing was sent to the AI.</p>}
      {m.status === "rejected" && <p className="text-xs text-amber-700 dark:text-amber-400">Answer withheld: the AI&apos;s answer could not be verified against the tickets.</p>}

      {m.citations.length > 0 && (
        <div className="space-y-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Sources
            {m.confidence && <Badge tone={confidenceTone(m.confidence)}>{m.confidence} confidence</Badge>}
          </div>
          <ul className="space-y-2">
            {m.citations.map((c, i) => (
              <li key={i} className="text-sm">
                <a href={`/history/${encodeURIComponent(c.ticket)}`} className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">
                  [{c.ticket}] {c.title}
                </a>
                <blockquote className="mt-1 border-l-2 border-zinc-300 pl-3 text-xs italic text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">{c.quote}</blockquote>
              </li>
            ))}
          </ul>
        </div>
      )}

      {m.status === "rejected" && m.sources.length > 0 && (
        <div className="space-y-1 border-t border-zinc-200 pt-2 text-sm dark:border-zinc-800">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Related tickets</div>
          <ul className="flex flex-wrap gap-3">
            {m.sources.map((s) => (
              <li key={s.key}>
                <a href={`/history/${encodeURIComponent(s.key)}`} className="text-blue-600 underline underline-offset-2 dark:text-blue-400">
                  [{s.key}] {s.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Chat({ initialSessionId, initialMessages, suggestions = SUGGESTIONS, initialInput = "" }: { initialSessionId: string | null; initialMessages: ChatMsg[]; suggestions?: string[]; initialInput?: string }) {
  const [messages, setMessages] = useState<ChatMsg[]>(initialMessages);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [input, setInput] = useState(initialInput);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || sending) return;
    const optimistic: ChatMsg = { id: `pending-${Date.now()}`, role: "user", content: text };
    setMessages((m) => [...m, optimistic]);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const res = await callApi<{ sessionId: string; message: Assistant }>("POST", "chat", sessionId ? { message: text, sessionId } : { message: text });
      if (!sessionId) window.history.replaceState(null, "", `/ask?s=${encodeURIComponent(res.sessionId)}`);
      setSessionId(res.sessionId);
      setMessages((m) => [...m, res.message]);
    } catch (e) {
      // Nothing was saved, so put the question back for another try.
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setInput(text);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-[70vh] min-h-96 flex-col rounded border border-zinc-200 dark:border-zinc-800">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Ask about past work. Answers come only from the ingested tickets and show the quotes they rely on.</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s} type="button" data-suggestion="" onClick={() => send(s)} className="rounded-full border border-zinc-300 px-3 py-1 text-left text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">{m.content}</div>
            </div>
          ) : (
            <div key={m.id} className="flex">
              <div className="max-w-[90%] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <Answer m={m} />
              </div>
            </div>
          ),
        )}

        {sending && <div className="text-sm text-zinc-500">Searching the tickets…</div>}
        <div ref={end} />
      </div>

      {error && (
        <p role="alert" className="border-t border-zinc-200 px-4 py-2 text-sm text-red-700 dark:border-zinc-800 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
        <textarea
          aria-label="Your question"
          value={input}
          maxLength={2000}
          rows={2}
          placeholder="Ask a question about the ticket history…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          className="flex-1 resize-none rounded border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
        />
        <button type="button" disabled={sending} onClick={() => send(input)} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          {sending ? "Thinking…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
