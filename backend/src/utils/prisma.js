import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__agendamentoPrisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__agendamentoPrisma = prisma;
}
