import { PrismaClient } from "@prisma/client";

export function createPrisma(_logger?: unknown): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}
