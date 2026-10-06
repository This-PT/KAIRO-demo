/** The original ticket text (already redacted by the policy filter), so summaries and quotes can be checked in context. */
export function SourceText({ text }: { text: string }) {
  return (
    <section id="source" className="scroll-mt-4 space-y-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Original ticket text (redacted)</h3>
      <p className="text-xs text-zinc-500">Secrets, passwords, tokens and emails were removed before storage.</p>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-3 text-sm dark:bg-zinc-900">{text}</pre>
    </section>
  );
}
