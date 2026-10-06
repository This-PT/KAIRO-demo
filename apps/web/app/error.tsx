"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The page could not load its data. Check that the API is running (<code>pnpm api</code>) and that <code>ADMIN_TOKEN</code> and <code>API_URL</code> are set for the web app.
      </p>
      {error.digest && <p className="text-xs text-zinc-500">Error id: {error.digest}</p>}
      <button type="button" onClick={reset} className="rounded border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700">
        Try again
      </button>
    </div>
  );
}
