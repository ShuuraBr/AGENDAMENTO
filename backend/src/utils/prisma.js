import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import prismaPkg from "@prisma/client";
import { fileURLToPath } from "url";

const { PrismaClient } = prismaPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");
const backendEnvPath = path.join(backendRoot, ".env");

dotenv.config({ override: true });

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: true });
}

const requiredDbVars = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
const hasDbParts = requiredDbVars.every((key) => {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "";
});

if (hasDbParts) {
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

let prismaClient = null;
let prismaInitError = null;

function getPrismaClient() {
  if (prismaClient) return prismaClient;
  if (prismaInitError) throw prismaInitError;

  try {
    prismaClient = new PrismaClient({
      log: ["error", "warn"]
    });

    if (process.env.NODE_ENV !== "production") {
      globalThis.__agendamentoPrisma = prismaClient;
    }

    return prismaClient;
  } catch (error) {
    prismaInitError = error;
    console.error("Falha ao inicializar PrismaClient:", error?.message || error);
    throw error;
  }
}

function createDeferredMethod(pathParts) {
  return async (...args) => {
    const client = getPrismaClient();

    let target = client;
    for (const part of pathParts) {
      target = target?.[part];
    }

    if (typeof target !== "function") {
      const error = new Error(`Método Prisma inválido: ${pathParts.join(".")}`);
      error.statusCode = 500;
      throw error;
    }

    return target.apply(pathParts.length > 1 ? client[pathParts[0]] : client, args);
  };
}

function createModelProxy(pathParts = []) {
  return new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.toStringTag) return "PrismaProxy";
      return createModelProxy([...pathParts, prop]);
    },
    apply() {
      return createDeferredMethod(pathParts)();
    }
  });
}

if (process.env.NODE_ENV !== "production" && globalThis.__agendamentoPrisma) {
  prismaClient = globalThis.__agendamentoPrisma;
}

export const prisma = createModelProxy();
export const getPrismaInitializationError = () => prismaInitError;
export const isPrismaReady = () => {
  try {
    return Boolean(getPrismaClient());
  } catch {
    return false;
  }
};
export { getPrismaClient };
