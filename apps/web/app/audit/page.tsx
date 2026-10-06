import { apiGet, type AuditItem } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const { items } = await apiGet<{ items: AuditItem[] }>("/api/audit?limit=100");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">AI Audit Log</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Every request sent to an AI model: when, which model, how many bytes, and the exact (already redacted) text. Restricted tickets never appear here because they are never sent.</p>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing has been sent to an AI yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {items.map((a) => (
            <li key={a.id} className="p-3">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-mono">{a.kind === "chat" ? `chat · ${a.ticketKeys.length} ticket(s)` : a.ticketKey}</span>
                  <span>{new Date(a.sentAt).toLocaleString()}</span>
                  <span className="text-zinc-500">
                    {a.provider}/{a.model}
                  </span>
                  <span className="text-zinc-500">{a.bytes} bytes</span>
                  <span className="text-zinc-500">{a.outcome}</span>
                </summary>
                {a.kind === "chat" && <p className="mt-2 text-xs text-zinc-500">Tickets sent with this question: {a.ticketKeys.join(", ")}</p>}
                <p className="mt-2 font-mono text-xs text-zinc-500">sha256 {a.payloadHash}</p>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">{a.payloadSnapshot}</pre>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
