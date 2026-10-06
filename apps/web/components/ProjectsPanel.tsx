"use client";

import { useState } from "react";
import { callApi } from "@/lib/client";
import type { Rule } from "@/lib/rules";
import { Badge } from "./Badge";
import { PolicyEditor } from "./PolicyEditor";

interface Project {
  key: string;
  name: string;
  enabled: boolean;
  ticketCount: number;
}

export function ProjectsPanel({ connection, initialProjects }: { connection: { mode: "demo" | "jira"; baseUrl: string; readOnly?: boolean }; initialProjects: Project[] }) {
  const readOnly = connection.readOnly === true;
  const [projects, setProjects] = useState(initialProjects);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState<{ key: string; rules: Rule[] } | null>(null);

  async function run(id: string, fn: () => Promise<string | void>) {
    setBusy(id);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Something went wrong", error: true });
    } finally {
      setBusy(null);
    }
  }

  const testConnection = () =>
    run("test", async () => {
      const r = await callApi<{ projects: { key: string }[] }>("POST", "connection/test");
      return `Connected. Found ${r.projects.length} project(s): ${r.projects.map((p) => p.key).join(", ") || "none"}.`;
    });
  const sync = () =>
    run("sync", async () => {
      setProjects(await callApi<Project[]>("POST", "projects/sync"));
      return "Projects synced.";
    });
  const toggle = (p: Project) =>
    run(`toggle-${p.key}`, async () => {
      await callApi("PATCH", `projects/${encodeURIComponent(p.key)}`, { enabled: !p.enabled });
      setProjects((ps) => ps.map((x) => (x.key === p.key ? { ...x, enabled: !p.enabled } : x)));
    });
  const ingest = (p: Project) =>
    run(`ingest-${p.key}`, async () => {
      await callApi("POST", `projects/${encodeURIComponent(p.key)}/ingest`);
      return `Ingest queued for ${p.key}. Tickets and summaries appear in History as the jobs finish.`;
    });
  const editPolicy = (p: Project) =>
    run(`rules-${p.key}`, async () => {
      if (editing?.key === p.key) return setEditing(null);
      const r = await callApi<{ rules: Rule[] }>("GET", `projects/${encodeURIComponent(p.key)}/rules`);
      setEditing({ key: p.key, rules: r.rules });
    });

  const btn = "rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

  return (
    <div className="space-y-8">
      {readOnly && <p className="rounded border border-amber-300 p-3 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-300">This is a read-only demo: connections, policy rules and ingests cannot be changed here.</p>}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Connection</h2>
        <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <Badge tone={connection.mode === "demo" ? "warn" : "good"}>{connection.mode === "demo" ? "Demo mode" : "Jira Cloud"}</Badge>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">{connection.mode === "demo" ? "Using fake tickets from the fixtures folder. No credentials needed." : connection.baseUrl}</span>
          <button type="button" className={btn} disabled={busy !== null || readOnly} onClick={testConnection}>
            Test connection
          </button>
        </div>
        <p className="text-xs text-zinc-500">Jira credentials are read from the server&apos;s environment variables (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN). They are never entered or shown here.</p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Projects &amp; policy</h2>
          <button type="button" className={btn} disabled={busy !== null || readOnly} onClick={sync}>
            Sync projects
          </button>
        </div>

        {message && (
          <p role="status" className={`text-sm ${message.error ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>
            {message.text}
          </p>
        )}

        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500">No projects yet. Click “Sync projects”.</p>
        ) : (
          <ul className="space-y-3">
            {projects.map((p) => (
              <li key={p.key} className="space-y-3">
                <div className="flex flex-wrap items-center gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <div className="min-w-40">
                    <div className="font-medium">{p.key}</div>
                    <div className="text-sm text-zinc-500">{p.name}</div>
                  </div>
                  <span className="text-sm text-zinc-500">{p.ticketCount} tickets</span>
                  <label className="flex items-center gap-1 text-sm">
                    <input type="checkbox" checked={p.enabled} disabled={busy !== null || readOnly} onChange={() => toggle(p)} />
                    Enabled
                  </label>
                  <button type="button" className={btn} disabled={busy !== null || readOnly} onClick={() => editPolicy(p)}>
                    {editing?.key === p.key ? "Close policy" : "Edit policy"}
                  </button>
                  <button type="button" className={btn} disabled={busy !== null || readOnly || !p.enabled} onClick={() => ingest(p)} title={p.enabled ? "" : "Enable the project first"}>
                    Ingest now
                  </button>
                </div>
                {editing?.key === p.key && <PolicyEditor projectKey={p.key} initialRules={editing.rules} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
