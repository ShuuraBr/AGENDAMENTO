import pkg from "@prisma/client";

const { PrismaClient } = pkg;

export const prisma = globalThis.__agendamentoPrisma || new PrismaClient();

if (!globalThis.__agendamentoPrisma) {
  globalThis.__agendamentoPrisma = prisma;
}
