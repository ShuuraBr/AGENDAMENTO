import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const envPath = path.join(backendRoot, '.env');

dotenv.config({ override: true });
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

const requiredDbVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const hasDbParts = requiredDbVars.every((key) => {
  const value = process.env[key];
  return typeof value === 'string' && value.trim() !== '';
});

if (!process.env.DATABASE_URL && hasDbParts) {
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

const prismaDisabledByEnv = ['1', 'true', 'yes', 'on'].includes(String(process.env.PRISMA_DISABLED || '').trim().toLowerCase());

let prismaClient = null;
let prismaLoadError = null;
let prismaLoadingPromise = null;
let prismaDisabled = prismaDisabledByEnv;
let prismaDisableReason = prismaDisabledByEnv ? 'Prisma desabilitado por variável de ambiente (PRISMA_DISABLED).' : null;

async function createPrismaClient() {
  if (prismaDisabled) {
    throw new Error(prismaDisableReason || 'Prisma está desabilitado.');
  }

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não foi definida no ambiente.');
  }

  const prismaPkg = await import('@prisma/client');
  const PrismaClient = prismaPkg.PrismaClient || prismaPkg.default?.PrismaClient;
  if (!PrismaClient) {
    throw new Error('PrismaClient não disponível. Execute npm install e npm run prisma:generate.');
  }
  const client = new PrismaClient({ log: ['error', 'warn'] });
  await client.$connect();
  return client;
}

function isPrismaEnginePanic(error) {
  const message = String(error?.message || error || '');
  return message.includes('PANIC: timer has gone away')
    || message.includes('PrismaClientRustPanicError')
    || message.includes('This is a non-recoverable error')
    || message.includes('Raw query failed. Code: `N/A`')
    || message.includes('Raw query failed. Code: `N/A`. Message: `N/A`');
}

async function setPrismaDisabled(reason, currentClient = prismaClient) {
  prismaDisabled = true;
  prismaDisableReason = String(reason || 'Prisma desabilitado.');
  prismaLoadError = new Error(prismaDisableReason);
  prismaLoadingPromise = null;
  prismaClient = null;

  if (currentClient && typeof currentClient.$disconnect === 'function') {
    try { await currentClient.$disconnect(); } catch {}
  }
}

export async function disablePrisma(error, context = 'runtime') {
  const message = String(error?.message || error || 'Falha desconhecida no Prisma');
  const reason = `Prisma desabilitado após falha em ${context}: ${message}`;
  await setPrismaDisabled(reason);
  return reason;
}

export async function resetPrismaClient() {
  const current = prismaClient;
  prismaClient = null;
  prismaLoadError = null;
  prismaLoadingPromise = null;
  if (!prismaDisabled) {
    prismaDisableReason = null;
  }
  if (current && typeof current.$disconnect === 'function') {
    try { await current.$disconnect(); } catch {}
  }
}

export async function getPrismaClient() {
  if (prismaDisabled) {
    throw new Error(prismaDisableReason || 'Prisma está desabilitado.');
  }

  if (prismaClient) return prismaClient;
  if (prismaLoadError) throw prismaLoadError;
  if (!prismaLoadingPromise) {
    prismaLoadingPromise = createPrismaClient()
      .then((client) => {
        prismaClient = client;
        return client;
      })
      .catch(async (error) => {
        if (isPrismaEnginePanic(error)) {
          await setPrismaDisabled(`Prisma desabilitado após panic do engine: ${String(error?.message || error || '')}`);
        } else {
          prismaLoadError = error;
        }
        throw prismaLoadError || error;
      })
      .finally(() => {
        prismaLoadingPromise = null;
      });
  }
  return prismaLoadingPromise;
}

export function getPrismaLoadError() {
  return prismaLoadError;
}

export function isPrismaDisabled() {
  return prismaDisabled;
}

export function getPrismaDisableReason() {
  return prismaDisableReason;
}

export function getPrismaStatus() {
  return {
    enabled: !prismaDisabled,
    reason: prismaDisableReason,
    hasClient: !!prismaClient
  };
}

function createModelProxy(pathParts = []) {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then' && pathParts.length === 0) return undefined;
      return createModelProxy([...pathParts, prop]);
    },
    apply(_target, _thisArg, args) {
      return (async () => {
        if (prismaDisabled) {
          throw new Error(prismaDisableReason || 'Prisma está desabilitado.');
        }

        const client = await getPrismaClient();
        let current = client;
        for (const part of pathParts) {
          current = current?.[part];
        }
        if (typeof current !== 'function') {
          throw new Error(`Operação Prisma inválida: ${pathParts.join('.')}`);
        }

        try {
          return await current.apply(client, args);
        } catch (error) {
          if (!isPrismaEnginePanic(error)) throw error;
          await disablePrisma(error, pathParts.join('.') || 'client');
          throw new Error(getPrismaDisableReason() || 'Prisma está desabilitado.');
        }
      })();
    }
  });
}

export const prisma = createModelProxy();
