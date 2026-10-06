import type { ReactNode } from "react";
import { CONTENT_FIELDS, groupEvidence, FIELD_LABELS } from "@/lib/format";
import type { Summary } from "@handover/core";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

/** All values are rendered as text nodes: model output derived from untrusted tickets is never injected as HTML. */
export function SummaryView({ summary: s }: { summary: Summary }) {
  const evidence = groupEvidence(s.evidence);
  return (
    <div className="space-y-6">
      {s.problem.trim() && (
        <Section title={FIELD_LABELS.problem}>
          <p>{s.problem}</p>
        </Section>
      )}
      {s.root_cause.trim() && (
        <Section title={FIELD_LABELS.root_cause}>
          <p>{s.root_cause}</p>
        </Section>
      )}
      {s.actions.length > 0 && (
        <Section title={FIELD_LABELS.actions}>
          <ul className="list-disc space-y-1 pl-5">
            {s.actions.map((a, i) => (
              <li key={i}>
                {a.what} <span className="text-sm text-zinc-500">({a.source})</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.rationale.trim() && (
        <Section title={FIELD_LABELS.rationale}>
          <p>{s.rationale}</p>
        </Section>
      )}
      {s.rejected_options.length > 0 && (
        <Section title={FIELD_LABELS.rejected_options}>
          <ul className="space-y-2">
            {s.rejected_options.map((r, i) => (
              <li key={i} className="rounded border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="font-medium">{r.option}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{r.why_rejected}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.gotchas.length > 0 && (
        <Section title={FIELD_LABELS.gotchas}>
          <ul className="list-disc space-y-1 pl-5">
            {s.gotchas.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </Section>
      )}
      {s.people.length > 0 && (
        <Section title="People">
          <p>{s.people.join(", ")}</p>
        </Section>
      )}
      {s.related.length > 0 && (
        <Section title="Related tickets">
          <ul className="flex flex-wrap gap-2">
            {s.related.map((k) => (
              <li key={k}>
                <a href={`/history/${encodeURIComponent(k)}`} className="text-blue-600 hover:underline dark:text-blue-400">
                  {k}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {s.missing.length > 0 && (
        <div data-testid="missing" className="rounded bg-zinc-100 p-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          Not stated in the ticket: {s.missing.map((f) => FIELD_LABELS[f]).join(", ")}
        </div>
      )}
      {s.evidence.length > 0 && (
        <Section title="Evidence">
          <p className="text-xs text-zinc-500">Quotes copied from the ticket and verified as present in it.</p>
          <div className="space-y-3">
            {CONTENT_FIELDS.filter((f) => evidence[f]).map((f) => (
              <div key={f}>
                <div className="text-xs font-medium text-zinc-500">{FIELD_LABELS[f]}</div>
                {evidence[f]!.map((q, i) => (
                  <blockquote key={i} className="border-l-2 border-zinc-300 pl-3 text-sm italic dark:border-zinc-700">
                    {q}
                  </blockquote>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
