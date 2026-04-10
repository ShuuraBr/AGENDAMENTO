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
let prismaRuntimeDisabled = false;
let prismaRuntimeDisableReason = null;

function stringifyError(error) {
  return String(error?.message || error || '');
}

function isPrismaRuntimePanic(error) {
  const message = stringifyError(error);
  return message.includes('PrismaClientRustPanicError')
    || message.includes('PANIC: timer has gone away')
    || message.includes('This is a non-recoverable error')
    || message.includes('Query Engine has a panic');
}

async function disablePrismaRuntime(error) {
  prismaRuntimeDisabled = true;
  prismaRuntimeDisableReason = stringifyError(error) || 'Prisma indisponível em runtime.';
  const client = prismaClient;
  prismaClient = null;
  if (client?.$disconnect) {
    try { await client.$disconnect(); } catch {}
  }
}

async function createPrismaClient() {
  const prismaPkg = await import('@prisma/client');
  const PrismaClient = prismaPkg.PrismaClient || prismaPkg.default?.PrismaClient;
  if (!PrismaClient) {
    throw new Error('PrismaClient não disponível. Execute npm install e npm run prisma:generate.');
  }
  return new PrismaClient({ log: ['error', 'warn'] });
}

export async function getPrismaClient() {
  if (prismaRuntimeDisabled) {
    throw new Error(prismaRuntimeDisableReason || 'Prisma indisponível em runtime.');
  }
  if (prismaClient) return prismaClient;
  if (prismaLoadError) throw prismaLoadError;
  if (!prismaLoadingPromise) {
    prismaLoadingPromise = createPrismaClient()
      .then((client) => {
        prismaClient = client;
        return client;
      })
      .catch((error) => {
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

export function isPrismaRuntimeDisabled() {
  return prismaRuntimeDisabled;
}

export function getPrismaRuntimeDisableReason() {
  return prismaRuntimeDisableReason;
}

function createModelProxy(pathParts = []) {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === 'then' && pathParts.length === 0) return undefined;
      return createModelProxy([...pathParts, prop]);
    },
    apply(_target, _thisArg, args) {
      return (async () => {
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
          if (isPrismaRuntimePanic(error)) {
            await disablePrismaRuntime(error);
          }
          throw error;
        }
      })();
    }
  });
}

export const prisma = createModelProxy();
