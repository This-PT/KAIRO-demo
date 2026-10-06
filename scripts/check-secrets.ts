import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_KEYS = /(TOKEN|KEY|PASSWORD|SECRET)/i;
const MIN_LENGTH = 12; // shorter values would match unrelated text everywhere

/** Real secret values in a .env file. Placeholders, blanks, comments and the well-known local DB password are skipped. */
export function secretsFromEnv(envText: string): string[] {
  const out = new Set<string>();
  for (const line of envText.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, name, raw] = m as unknown as [string, string, string];
    const value = raw.trim();
    if (name === "DATABASE_URL") {
      const pw = /^[a-z]+:\/\/[^:]+:([^@]+)@/.exec(value)?.[1];
      if (pw && pw !== "handover" && pw.length >= 8) out.add(decodeURIComponent(pw));
    } else if (SECRET_KEYS.test(name) && value.length >= MIN_LENGTH) {
      out.add(value);
    }
  }
  return [...out];
}

/** Minimal .gitignore matching: names (any folder level) and *.ext patterns. */
export function isIgnored(path: string, patterns: string[]): boolean {
  const parts = path.split("/");
  const base = parts[parts.length - 1]!;
  return patterns.some((p) => (p.startsWith("*.") ? base.endsWith(p.slice(1)) : parts.includes(p)));
}

export interface Leak {
  path: string;
}

/** Which files contain any of the secrets. The secret values are never part of the result. */
export function findLeaks(files: { path: string; content: string }[], secrets: string[]): Leak[] {
  return files.filter((f) => secrets.some((s) => f.content.includes(s))).map((f) => ({ path: f.path }));
}

// Strings that look like real provider keys. Hosting services such as GitHub refuse pushes containing them
// ("push protection"), even when they are invented test data, so they are caught here first.
const SHAPES: { kind: string; re: RegExp; allow?: string[] }[] = [
  { kind: "Stripe API key", re: /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g },
  { kind: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: "AWS access key", re: /AKIA[0-9A-Z]{16}/g, allow: ["AKIAIOSFODNN7EXAMPLE"] }, // the documented example key is accepted everywhere
  { kind: "Slack token", re: /xox[baprs]-[0-9]{8,}-[0-9]{8,}-[A-Za-z0-9]{20,}/g },
  { kind: "OpenAI key", re: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g },
  { kind: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
];

export interface ShapeLeak {
  path: string;
  kind: string;
}

/** Files containing key-shaped strings, by kind. The matched text is never part of the result. */
export function findSecretShapes(files: { path: string; content: string }[]): ShapeLeak[] {
  const out: ShapeLeak[] = [];
  for (const f of files) {
    for (const s of SHAPES) {
      const hits = f.content.match(s.re)?.filter((m) => !s.allow?.includes(m));
      if (hits?.length) out.push({ path: f.path, kind: s.kind });
    }
  }
  return out;
}

// ------------------------------------------------------------------ CLI: `pnpm check:secrets`
function walk(root: string, dir: string, ignore: string[], acc: { path: string; content: string }[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join("/");
    if (isIgnored(rel, ignore) || rel === ".git") continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(root, full, ignore, acc);
    else if (st.size < 2_000_000) acc.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = process.cwd();
  const ignore = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const secrets = secretsFromEnv(readFileSync(join(root, ".env"), "utf8"));
  const files: { path: string; content: string }[] = [];
  walk(root, root, ignore, files);
  const leaks = findLeaks(files, secrets);
  const shapes = findSecretShapes(files);
  console.log(`Checked ${files.length} files that would be uploaded against ${secrets.length} secret value(s) from .env, and for key-shaped strings.`);
  if (leaks.length) {
    console.error(`\nSTOP: your secret values were found in:\n${leaks.map((l) => `  - ${l.path}`).join("\n")}\nRemove them (and rotate those secrets) before pushing.`);
    process.exit(1);
  }
  if (shapes.length) {
    console.error(`\nSTOP: strings that look like real keys (GitHub will refuse the push) in:\n${shapes.map((l) => `  - ${l.path}  [${l.kind}]`).join("\n")}\nUse short, obviously fake values (for example sk_live_FAKEDEMO0001), or build the string in code.`);
    process.exit(1);
  }
  console.log("OK: none of your secret values appear in files that would be uploaded, and nothing looks like a real key.");
}
