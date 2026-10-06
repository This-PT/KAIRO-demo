import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@handover/db";
import { seedIfEmpty, type SummaryExport } from "./seed";

const file = fileURLToPath(new URL("../../../fixtures/showcase-summaries.json", import.meta.url));
const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error("seed: ENCRYPTION_KEY is missing.");
  process.exit(1);
}
if (!existsSync(file)) {
  console.error(`seed: ${file} not found. Generate it with: pnpm demo:export`);
  process.exit(1);
}

const summaries = JSON.parse(readFileSync(file, "utf8")) as SummaryExport;
const r = await seedIfEmpty({ db: prisma, encryptionKey, summaries, log: (l) => console.log(`seed: ${l}`) });
console.log(r ? "seed: demo data loaded." : "seed: database already has data, nothing changed.");
if (r && (r.invalid.length || r.missing.length)) console.warn(`seed: invalid=${r.invalid.join(",") || "-"} missing=${r.missing.join(",") || "-"} (run pnpm demo:export after regenerating summaries)`);
await prisma.$disconnect();
