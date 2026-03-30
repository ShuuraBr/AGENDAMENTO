import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const backendEnvPath = path.join(backendRoot, ".env");

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false });
} else {
  dotenv.config();
}

function cleanEnvValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().replace(/^['"]|['"]$/g, "");
}

function buildDatabaseUrlFromParts() {
  const host = cleanEnvValue(process.env.DB_HOST);
  const port = cleanEnvValue(process.env.DB_PORT || "3306");
  const database = cleanEnvValue(process.env.DB_NAME);
  const user = cleanEnvValue(process.env.DB_USER);
  const pass = cleanEnvValue(process.env.DB_PASS);

  if (!host || !database || !user) {
    return "";
  }

  return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${database}`;
}

function ensureDatabaseUrl() {
  const explicitUrl = cleanEnvValue(process.env.DATABASE_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const builtUrl = buildDatabaseUrlFromParts();
  if (builtUrl) {
    process.env.DATABASE_URL = builtUrl;
    return builtUrl;
  }

  return "";
}

function classifyPrismaInitError(error) {
  const message = error?.message || String(error || "Falha ao inicializar PrismaClient.");

  if (/Authentication failed against database server/i.test(message)) {
    return new Error(
      "Falha de autenticação no banco. Revise DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASS no arquivo .env. Se a senha tiver caracteres especiais como @, :, / ou #, prefira preencher DB_PASS e deixar o DATABASE_URL vazio para o sistema montar a URL automaticamente."
    );
  }

  if (/Environment variable not found: DATABASE_URL/i.test(message) || /error validating datasource/i.test(message)) {
    return new Error(
      "DATABASE_URL não foi definida corretamente. Preencha DATABASE_URL ou informe DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASS no .env."
    );
  }

  return error instanceof Error ? error : new Error(message);
}

let prismaClient = null;
let prismaInitError = null;

function createDeferredMethod(path) {
  return async (...args) => {
    const client = getPrismaClient();
    if (!client) {
      const error = prismaInitError || new Error("Prisma client indisponível.");
      error.statusCode = error.statusCode || 503;
      throw error;
    }

    let target = client;
    for (const segment of path) {
      target = target?.[segment];
    }

    if (typeof target !== "function") {
      const error = new Error(`Método Prisma inválido: ${path.join(".")}`);
      error.statusCode = 500;
      throw error;
    }

    return target.apply(path.length > 1 ? client[path[0]] : client, args);
  };
}

function createModelProxy(path = []) {
  return new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.toStringTag) return "PrismaProxy";
      return createModelProxy([...path, prop]);
    },
    apply() {
      return createDeferredMethod(path)();
    }
  });
}

function getPrismaClient() {
  if (prismaClient) return prismaClient;
  if (prismaInitError) return null;

  try {
    ensureDatabaseUrl();
    prismaClient = new PrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__agendamentoPrisma = prismaClient;
    }
    return prismaClient;
  } catch (error) {
    prismaInitError = classifyPrismaInitError(error);
    prismaInitError.statusCode = prismaInitError.statusCode || 503;
    console.error("Falha ao inicializar PrismaClient:", prismaInitError.message);
    return null;
  }
}

if (process.env.NODE_ENV !== "production" && globalThis.__agendamentoPrisma) {
  prismaClient = globalThis.__agendamentoPrisma;
}

export const prisma = createModelProxy();
export const getPrismaInitializationError = () => prismaInitError;
export const isPrismaReady = () => Boolean(getPrismaClient());
export { ensureDatabaseUrl, getPrismaClient };
