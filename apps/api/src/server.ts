import { createProvider } from "@handover/ai";
import { prisma } from "@handover/db";
import IORedis from "ioredis";
import { buildApp } from "./app";
import { createConnector, loadConfig } from "./config";
import { createDisabledQueues, createQueues, startWorkers } from "./queues";

const config = loadConfig();
const { connector, info } = createConnector(config);
const provider = createProvider();

// Without Redis (read-only demo only) there are no queues and no background workers.
const redis = config.redisUrl ? new IORedis(config.redisUrl, { maxRetriesPerRequest: null }) : null;
const queues = redis ? createQueues(redis) : createDisabledQueues();
const workers = redis
  ? startWorkers({
      redis,
      db: prisma,
      queues,
      connector,
      provider,
      encryptionKey: config.encryptionKey,
      summarizeConcurrency: config.summarizeConcurrency,
    })
  : null;

const app = await buildApp({
  db: prisma,
  queues,
  connector,
  provider,
  config: { adminToken: config.adminToken, webOrigin: config.webOrigin, connection: info, readOnly: config.readOnly, chatDailyLimit: config.chatDailyLimit },
});

// Localhost only until real auth exists.
await app.listen({ host: "127.0.0.1", port: config.port });
if (config.readOnly) console.log("READ-ONLY demo mode: writes are disabled; chat is limited.");
if (!redis) console.log("No Redis configured: background jobs are disabled.");
console.log(`Handover API on http://127.0.0.1:${config.port} (source: ${info.mode}, llm: ${provider.name}/${provider.model})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await app.close();
    await workers?.close();
    await queues.close();
    await redis?.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
}
