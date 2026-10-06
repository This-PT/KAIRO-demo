import { PrismaClient } from "@prisma/client";
export * from "@prisma/client";
export const prisma = new PrismaClient();
export * from "./testing";
