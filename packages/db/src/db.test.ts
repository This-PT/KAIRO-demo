import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./index";

describe("database", () => {
  afterAll(() => prisma.$disconnect());
  it("connects and migrations are applied", async () => {
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`select count(*) n from "Ticket"`;
    expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(0);
  });
  it("has pgvector installed", async () => {
    const rows = await prisma.$queryRaw<{ extname: string }[]>`select extname from pg_extension where extname='vector'`;
    expect(rows).toHaveLength(1);
  });
});
