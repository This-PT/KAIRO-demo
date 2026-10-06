import { notFound } from "next/navigation";
import { Badge } from "@/components/Badge";
import { ResummarizeButton } from "@/components/ResummarizeButton";
import { SourceLink } from "@/components/SourceLink";
import { SourceText } from "@/components/SourceText";
import { SummaryView } from "@/components/SummaryView";
import { ApiError, apiGet, type TicketDetail } from "@/lib/api";
import { confidenceTone, parseSummary } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  let t: TicketDetail;
  let demo = false;
  let readOnly = false;
  try {
    const [ticket, connection] = await Promise.all([apiGet<TicketDetail>(`/api/tickets/${encodeURIComponent(key)}`), apiGet<{ mode: "demo" | "jira"; readOnly?: boolean }>("/api/connection")]);
    t = ticket;
    demo = connection.mode === "demo";
    readOnly = connection.readOnly === true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }

  const s = t.summary;
  const parsed = s ? parseSummary(s.json) : null;
  const reasons = s && !parsed && Array.isArray((s.json as { reasons?: unknown })?.reasons) ? ((s.json as { reasons: unknown[] }).reasons.filter((r): r is string => typeof r === "string")) : [];

  return (
    <article className="space-y-6">
      <div className="space-y-2">
        <a href="/history" className="text-sm text-zinc-500 hover:underline">
          ← Task History
        </a>
        <h1 className="text-2xl font-semibold">
          <span className="font-mono text-lg text-zinc-500">{t.key}</span> {t.title}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone={t.visibility === "restricted" ? "bad" : "neutral"}>{t.visibility}</Badge>
          <span className="text-zinc-500">Status: {t.status}</span>
          {/* In demo mode the ticket URL is fake, so only offer the in-app source text. */}
          {demo ? t.sourceText ? <SourceLink url={t.url} label="View original ticket text" demoHref="#source" /> : null : <SourceLink url={t.url} label={`Open ${t.key} in Jira`} />}
        </div>
      </div>

      {t.visibility === "restricted" ? (
        <p className="rounded border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          This ticket is restricted by policy. Its content is stored encrypted and is never shown here or sent to the AI. Open it in the source system if you have access.
        </p>
      ) : !s ? (
        <div className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No summary yet.</p>
          {!readOnly && <ResummarizeButton ticketKey={t.key} />}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            {parsed ? <Badge tone={confidenceTone(s.confidence)}>{s.confidence} confidence</Badge> : <Badge tone="bad">rejected</Badge>}
            {s.evidenceVerified && <Badge tone="good">evidence verified</Badge>}
            <span className="text-zinc-500">
              {s.model} · prompt {s.promptVersion} · {s.attempts} attempt(s) · {new Date(s.createdAt).toLocaleString()}
            </span>
            {!readOnly && <ResummarizeButton ticketKey={t.key} />}
          </div>
          {parsed ? (
            <SummaryView summary={parsed} />
          ) : (
            <div className="space-y-2 rounded border border-red-200 p-4 text-sm dark:border-red-900">
              <p>The AI output could not be verified against the ticket, so no summary is shown.</p>
              {reasons.length > 0 && (
                <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
                  {reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
      {t.sourceText && <SourceText text={t.sourceText} />}
    </article>
  );
}
