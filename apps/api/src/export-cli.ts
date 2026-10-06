import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "@kairo/db";
import { exportSummaries } from "./seed";

const out = fileURLToPath(new URL("../../../fixtures/showcase-summaries.json", import.meta.url));
const data = await exportSummaries(prisma, "SHOP");
if (data.summaries.length === 0) {
  console.error("export: no summaries found for project SHOP. Run `pnpm demo:showcase` first.");
  process.exit(1);
}
writeFileSync(out, JSON.stringify(data, null, 1) + "\n");
const models = [...new Set(data.summaries.map((s) => s.model))].join(", ");
console.log(`export: wrote ${data.summaries.length} summaries (model: ${models}) to fixtures/showcase-summaries.json`);
await prisma.$disconnect();
