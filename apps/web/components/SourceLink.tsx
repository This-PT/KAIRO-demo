import { safeHref } from "@/lib/format";

const LINK = "text-blue-600 underline underline-offset-2 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300";

/**
 * Link to the source ticket. Anything that is not an http(s) URL renders as plain text.
 * With `demoHref` (demo mode, where the ticket URL is fake and leads nowhere) it links to the in-app source text instead.
 */
export function SourceLink({ url, label, demoHref }: { url: string; label: string; demoHref?: string }) {
  if (demoHref) {
    return (
      <a href={demoHref} className={LINK}>
        {label}
      </a>
    );
  }
  const href = safeHref(url);
  if (!href) return <span>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {label} <span aria-hidden>↗</span>
    </a>
  );
}
