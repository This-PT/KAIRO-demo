import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const defaultGenerators = {
  key: () => randomBytes(32).toString("base64"),
  token: () => randomBytes(18).toString("hex"),
};

const SECRETS = ["ENCRYPTION_KEY", "ADMIN_TOKEN"] as const;
const valueOf = (text: string, name: string) => new RegExp(`^${name}=(.*)$`, "m").exec(text)?.[1];

/**
 * Builds the contents of .env. Starts from the example (or the user's file), fills only blank secrets,
 * appends settings the user's file lacks, and never changes a value the user already set.
 * `changes` names what was touched and never contains secret values.
 */
export function buildEnv(example: string, existing: string | null, gen = defaultGenerators): { text: string; changes: string[] } {
  const changes: string[] = [];
  let text = existing ?? example;
  if (existing === null) changes.push("created .env from .env.example");

  for (const name of SECRETS) {
    const v = valueOf(text, name);
    if (v === undefined || v.trim() === "") {
      const value = name === "ENCRYPTION_KEY" ? gen.key() : gen.token();
      text = v === undefined ? `${text.replace(/\n?$/, "\n")}${name}=${value}\n` : text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`);
      changes.push(`generated ${name}`);
    }
  }

  if (existing !== null) {
    for (const line of example.split("\n")) {
      const name = /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1];
      if (name && valueOf(text, name) === undefined) {
        text = `${text.replace(/\n?$/, "\n")}${line}\n`;
        changes.push(`added missing setting ${name}`);
      }
    }
  }
  return { text, changes };
}

// CLI: `pnpm setup`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const example = readFileSync(".env.example", "utf8");
  const existing = existsSync(".env") ? readFileSync(".env", "utf8") : null;
  const { text, changes } = buildEnv(example, existing);
  if (changes.length === 0) {
    console.log(".env is already complete. Nothing changed.");
  } else {
    writeFileSync(".env", text);
    for (const c of changes) console.log(`- ${c}`);
    console.log("Saved .env (keep it private; it is git-ignored).");
  }
}
