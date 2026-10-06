import { describe, expect, it } from "vitest";
import { createDisabledQueues } from "./queues";

describe("createDisabledQueues (deployments without Redis)", () => {
  it("refuses to enqueue anything, with a clear reason", async () => {
    const q = createDisabledQueues();
    await expect(q.enqueueIngest("HND")).rejects.toThrow(/background jobs are disabled/i);
    await expect(q.enqueueSummarize("HND-1")).rejects.toThrow(/background jobs are disabled/i);
  });
  it("closes cleanly", async () => {
    await expect(createDisabledQueues().close()).resolves.toBeUndefined();
  });
});
