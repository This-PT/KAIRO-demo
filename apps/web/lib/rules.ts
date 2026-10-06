export type Visibility = "readable" | "restricted";
export interface RuleDraft {
  label: string;
  visibility: Visibility;
}
export interface Rule {
  label: string | null;
  visibility: Visibility;
}

/** Trims labels; a blank label is the project-wide rule. Reports problems instead of silently fixing them. */
export function normalizeRules(draft: RuleDraft[]): { rules: Rule[]; errors: string[] } {
  const rules = draft.map((d) => ({ label: d.label.trim() === "" ? null : d.label.trim(), visibility: d.visibility }));
  const errors: string[] = [];
  if (rules.filter((r) => r.label === null).length > 1) errors.push("Only one project-wide rule (blank label) is allowed.");
  const seen = new Set<string>();
  for (const r of rules) {
    if (r.label === null) continue;
    const k = r.label.toLowerCase();
    if (seen.has(k)) errors.push(`Duplicate label: ${r.label}`);
    seen.add(k);
  }
  return { rules, errors };
}

/** Plain-language summary of what a rule set does, shown next to the editor. */
export function describeEffect(rules: Rule[]): string[] {
  if (rules.length === 0) return ["No rules: every ticket is restricted, so nothing from this project is sent to the AI."];
  const lines: string[] = [];
  const base = rules.find((r) => r.label === null);
  lines.push(base ? `Project default: ${base.visibility}.` : "Other tickets (no matching rule) stay restricted.");
  for (const r of rules) if (r.label !== null) lines.push(`Label "${r.label}": ${r.visibility}.`);
  if (rules.some((r) => r.label !== null && r.visibility === "restricted")) lines.push("A restricted label always wins over a readable one.");
  return lines;
}
