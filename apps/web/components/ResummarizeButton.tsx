"use client";

import { useState } from "react";
import { callApi } from "@/lib/client";

export function ResummarizeButton({ ticketKey }: { ticketKey: string }) {
  const [state, setState] = useState<{ kind: "idle" | "busy" | "done" | "failed"; text?: string }>({ kind: "idle" });
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={state.kind === "busy"}
        onClick={async () => {
          setState({ kind: "busy" });
          try {
            await callApi("POST", `tickets/${encodeURIComponent(ticketKey)}/summarize`);
            setState({ kind: "done", text: "Queued. Refresh in a few seconds." });
          } catch (e) {
            setState({ kind: "failed", text: e instanceof Error ? e.message : "Failed" });
          }
        }}
        className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Summarize again
      </button>
      {state.text && <span className={`text-sm ${state.kind === "failed" ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>{state.text}</span>}
    </span>
  );
}
