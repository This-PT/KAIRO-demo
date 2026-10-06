"use client";

import { useState } from "react";
import { callApi } from "@/lib/client";
import { describeEffect, normalizeRules, type Rule, type RuleDraft, type Visibility } from "@/lib/rules";

interface Row extends RuleDraft {
  id: number;
}

export function PolicyEditor({ projectKey, initialRules }: { projectKey: string; initialRules: Rule[] }) {
  const [nextId, setNextId] = useState(initialRules.length);
  const [rows, setRows] = useState<Row[]>(() => initialRules.map((r, i) => ({ id: i, label: r.label ?? "", visibility: r.visibility })));
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "failed"; message?: string }>({ kind: "idle" });

  const { rules, errors: draftErrors } = normalizeRules(rows);
  const effect = draftErrors.length ? [] : describeEffect(rules);

  const update = (id: number, patch: Partial<RuleDraft>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function save() {
    const n = normalizeRules(rows);
    setErrors(n.errors);
    if (n.errors.length) return;
    setStatus({ kind: "saving" });
    try {
      const res = await callApi<{ reingestJobId: string | null }>("PUT", `projects/${encodeURIComponent(projectKey)}/rules`, { rules: n.rules });
      setStatus({
        kind: "saved",
        message: res.reingestJobId ? "Saved. A re-ingest was queued so the new rules apply to existing tickets." : "Saved. Enable the project and run an ingest to apply them.",
      });
    } catch (e) {
      setStatus({ kind: "failed", message: `Could not save: ${e instanceof Error ? e.message : "unknown error"}` });
    }
  }

  return (
    <div className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <strong>Readable</strong> tickets are redacted (keys, passwords, tokens, emails) and may be sent to the AI. <strong>Restricted</strong> tickets are stored encrypted and never sent. A blank label applies to the whole project.
      </p>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <input
              aria-label="Label"
              value={r.label}
              onChange={(e) => update(r.id, { label: e.target.value })}
              placeholder="label (blank = whole project)"
              className="w-64 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            />
            <select
              aria-label="Visibility"
              value={r.visibility}
              onChange={(e) => update(r.id, { visibility: e.target.value as Visibility })}
              className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            >
              <option value="readable">readable</option>
              <option value="restricted">restricted</option>
            </select>
            <button type="button" aria-label="Remove rule" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="px-2 text-zinc-500 hover:text-red-600">
              ✕
            </button>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={() => {
          setRows((rs) => [...rs, { id: nextId, label: "", visibility: "restricted" }]);
          setNextId((n) => n + 1);
        }}
        className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Add rule
      </button>

      <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        {effect.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>

      {errors.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-sm text-red-700 dark:text-red-400">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={status.kind === "saving"} className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
          Save rules
        </button>
        {status.message && <span className={`text-sm ${status.kind === "failed" ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{status.message}</span>}
      </div>
    </div>
  );
}
