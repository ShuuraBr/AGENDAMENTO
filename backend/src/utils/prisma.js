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

let prismaClient = null;
let prismaLoadError = null;
let prismaLoadingPromise = null;
let prismaDisabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.PRISMA_DISABLED || '').trim().toLowerCase());
let prismaDisableReason = prismaDisabled ? 'Prisma desabilitado por variável de ambiente (PRISMA_DISABLED).' : null;
let panicAlreadyLogged = false;

async function createPrismaClient() {
  if (prismaDisabled) {
    throw new Error(prismaDisableReason || 'Prisma desabilitado.');
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

export function isPrismaEnginePanic(error) {
  const message = String(error?.message || error || '');
  return message.includes('PANIC: timer has gone away')
    || message.includes('PrismaClientRustPanicError')
    || message.includes('This is a non-recoverable error')
    || message.includes('Raw query failed. Code: `N/A`')
    || message.includes('Raw query failed. Code: `N/A`. Message: `N/A`');
}

async function disconnectCurrentClientSilently() {
  const current = prismaClient;
  prismaClient = null;
  prismaLoadingPromise = null;
  if (current && typeof current.$disconnect === 'function') {
    try { await current.$disconnect(); } catch {}
  }
}

export async function disablePrisma(reason = 'Prisma desabilitado.') {
  prismaDisabled = true;
  prismaDisableReason = String(reason || 'Prisma desabilitado.');
  prismaLoadError = new Error(prismaDisableReason);
  await disconnectCurrentClientSilently();
  if (!panicAlreadyLogged) {
    console.error(`[PRISMA] ${prismaDisableReason}`);
    panicAlreadyLogged = true;
  }
  return prismaLoadError;
}

export async function resetPrismaClient() {
  await disconnectCurrentClientSilently();
  prismaLoadError = null;
  prismaLoadingPromise = null;
  if (!prismaDisabled) prismaDisableReason = null;
}

export function isPrismaDisabled() {
  return prismaDisabled;
}

export function getPrismaDisableReason() {
  return prismaDisableReason;
}

export function getPrismaStatus() {
  return {
    disabled: prismaDisabled,
    reason: prismaDisableReason,
    hasClient: !!prismaClient,
    hasLoadError: !!prismaLoadError
  };
}

export async function getPrismaClient() {
  if (prismaDisabled) {
    throw prismaLoadError || new Error(prismaDisableReason || 'Prisma desabilitado.');
  }
  if (prismaClient) return prismaClient;
  if (prismaLoadError) throw prismaLoadError;
  if (!prismaLoadingPromise) {
    prismaLoadingPromise = createPrismaClient()
      .then((client) => {
        prismaClient = client;
        prismaLoadError = null;
        return client;
      })
      .catch(async (error) => {
        if (isPrismaEnginePanic(error)) {
          throw await disablePrisma(`Prisma desabilitado após panic do engine: ${error?.message || error}`);
        }
        prismaLoadError = error;
        throw error;
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

function createModelProxy(pathParts = []) {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then' && pathParts.length === 0) return undefined;
      return createModelProxy([...pathParts, prop]);
    },
    apply(_target, _thisArg, args) {
      return (async () => {
        try {
          const client = await getPrismaClient();
          let current = client;
          for (const part of pathParts) {
            current = current?.[part];
          }
          if (typeof current !== 'function') {
            throw new Error(`Operação Prisma inválida: ${pathParts.join('.')}`);
          }
          return await current.apply(client, args);
        } catch (error) {
          if (!isPrismaEnginePanic(error)) throw error;
          throw await disablePrisma(`Prisma desabilitado após panic do engine: ${error?.message || error}`);
        }
      })();
    }
  });
}

export const prisma = createModelProxy();
