export type RedactionType = "api_key" | "password" | "token" | "email";
export interface RedactionEvent {
  type: RedactionType;
  count: number;
}
export interface RedactResult {
  text: string;
  events: RedactionEvent[];
}

const SKIP = String.raw`(?!\[REDACTED)`;

// Order matters: specific shapes first, generic key=value and emails last.
const RULES: { type: RedactionType; re: RegExp; replace: (m: string, ...g: string[]) => string }[] = [
  { type: "api_key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replace: () => "[REDACTED:api_key]" },
  { type: "token", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, replace: () => "[REDACTED:token]" },
  {
    type: "api_key",
    re: /\b(?:sk_(?:live|test)_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    replace: () => "[REDACTED:api_key]",
  },
  { type: "token", re: new RegExp(String.raw`\b(Bearer\s+)${SKIP}[A-Za-z0-9._~+/-]+=*`, "gi"), replace: (_m, p) => `${p}[REDACTED:token]` },
  {
    type: "password",
    re: new RegExp(String.raw`\b(password|passwd|pwd)(["']?\s*[:=]\s*["']?)${SKIP}([^\s"',;]+)`, "gi"),
    replace: (_m, k, sep) => `${k}${sep}[REDACTED:password]`,
  },
  {
    type: "token",
    re: new RegExp(String.raw`\b(token|access_token|auth_token|api[_-]?key|secret)(["']?\s*[:=]\s*["']?)${SKIP}([^\s"',;]+)`, "gi"),
    replace: (_m, k, sep) => `${k}${sep}[REDACTED:token]`,
  },
  { type: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, replace: () => "[REDACTED:email]" },
];

/** Replaces secrets with [REDACTED:type] placeholders. Events hold counts only, never values. */
export function redact(input: string): RedactResult {
  const counts = new Map<RedactionType, number>();
  let text = input;
  for (const { type, re, replace } of RULES) {
    text = text.replace(re, (...args) => {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      return replace(args[0] as string, ...(args.slice(1) as string[]));
    });
  }
  return { text, events: [...counts].map(([type, count]) => ({ type, count })) };
}
