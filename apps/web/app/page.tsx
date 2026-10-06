import { apiGet, type Project } from "@/lib/api";
import { suggestionsFor } from "@/lib/chat";

export const dynamic = "force-dynamic";

const CARDS = [
  { href: "/history", title: "Task History", text: "Every ticket turned into a short record: the problem, what was done and why, what was rejected, and the gotchas. Each claim links to a quote from the ticket." },
  { href: "/tree", title: "Work Tree", text: "See how the work fits together: epics, stories and sub-tasks drawn as a tree, with links between related tickets." },
  { href: "/ask", title: "Ask AI", text: "Ask a question in plain words. Answers use only the ticket history and cite the exact quotes, or say they could not find it." },
  { href: "/settings", title: "Connect & Policy", text: "Choose which projects to read and which tickets are restricted. Restricted tickets are encrypted and never sent to an AI." },
];

export default async function Home() {
  const [projects, tickets, connection] = await Promise.all([
    apiGet<Project[]>("/api/projects"),
    apiGet<{ total: number }>("/api/tickets?limit=1"),
    apiGet<{ mode: "demo" | "jira"; readOnly?: boolean }>("/api/connection"),
  ]);
  const questions = suggestionsFor(projects.map((p) => p.key));

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold">Keep what your team knows when people leave</h1>
        <p className="max-w-2xl text-zinc-600 dark:text-zinc-400">
          Kairo reads your tickets and keeps the reasoning that usually disappears: why a decision was made, what was tried and rejected, and what to watch out for. A new teammate can read it, or just ask.
        </p>
        <p className="text-sm text-zinc-500">
          {tickets.total > 0 ? (
            <>
              {tickets.total} tickets loaded from {projects.length} project{projects.length === 1 ? "" : "s"}
              {connection.mode === "demo" ? " (fake demo data)" : ""}.
            </>
          ) : (
            <>
              Nothing is loaded yet. Go to <a href="/settings" className="text-blue-600 underline dark:text-blue-400">Connect &amp; Policy</a> to load a project.
            </>
          )}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <a key={c.href} href={c.href} className="rounded-lg border border-zinc-200 p-4 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900">
            <h2 className="font-semibold">{c.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{c.text}</p>
          </a>
        ))}
      </section>

      {tickets.total > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Try asking</h2>
          <ul className="space-y-2">
            {questions.map((q) => (
              <li key={q}>
                <a href={`/ask?q=${encodeURIComponent(q)}`} className="text-blue-600 underline underline-offset-2 dark:text-blue-400">
                  {q}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        <h2 className="mb-1 font-semibold text-zinc-900 dark:text-zinc-100">How it stays safe</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Passwords, keys, tokens and emails are removed before anything is sent to an AI.</li>
          <li>Restricted tickets are stored encrypted and are never sent, shown or searched.</li>
          <li>Every AI request is recorded in the AI Audit Log, including exactly what was sent.</li>
          <li>Answers must be backed by quotes copied from the tickets, and the quotes are checked.</li>
        </ul>
      </section>
    </div>
  );
}
