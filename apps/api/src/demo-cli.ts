import { createProvider } from "@kairo/ai";
import { prisma } from "@kairo/db";
import { runDemo } from "./demo";

const encryptionKey = process.env.ENCRYPTION_KEY;
if (!encryptionKey) {
  console.error("ENCRYPTION_KEY is missing. Run `pnpm setup` to create your .env file.");
  process.exit(1);
}

const provider = createProvider();
console.log(`Kairo demo on fixture tickets (summarizer: ${provider.name}/${provider.model})`);
if (provider.name !== "heuristic") console.log("Note: the redacted text of the fake fixture tickets will be sent to this provider.");

const dataset = process.argv.includes("--showcase") ? "showcase" : "basic";
console.log(`Dataset: ${dataset === "showcase" ? "Shopfront team (25 tickets)" : "basic test fixtures (10 tickets)"}`);
const result = await runDemo({ db: prisma, provider, encryptionKey, dataset, reset: process.argv.includes("--reset"), log: console.log });

console.log("\nTicket    Visibility  Summary");
for (const t of result.tickets) console.log(`${t.key.padEnd(9)} ${t.visibility.padEnd(11)} ${t.summary ?? "-"}`);
console.log(`\nSummaries: ${result.summaries.ok} ok, ${result.summaries.downgraded} downgraded, ${result.summaries.rejected} rejected`);
console.log("Start `pnpm api` and `pnpm web`, then open http://localhost:3000/history");
await prisma.$disconnect();
