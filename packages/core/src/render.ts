import type { NormalizedTicket } from "./index";

/** The exact text the AI sees. Evidence quotes are verified against this string. */
export function renderTicketText(t: NormalizedTicket): string {
  const lines = [`[${t.key}] ${t.title}`, `Status: ${t.status}`, `Labels: ${t.labels.join(", ")}`, "Description:", t.description];
  if (t.comments.length) {
    lines.push("Comments:");
    for (const c of t.comments) lines.push(`- ${c.author} (${c.created}): ${c.body}`);
  }
  if (t.changelog.length) {
    lines.push("Changelog:");
    for (const h of t.changelog) lines.push(`- ${h.created} ${h.author} changed ${h.field}: ${h.from ?? "(none)"} -> ${h.to ?? "(none)"}`);
  }
  if (t.links.length) {
    lines.push("Links:");
    for (const l of t.links) lines.push(`- ${l.type} ${l.key}`);
  }
  return lines.join("\n");
}
