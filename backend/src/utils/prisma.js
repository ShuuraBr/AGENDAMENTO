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

async function createPrismaClient() {
  const prismaPkg = await import('@prisma/client');
  const PrismaClient = prismaPkg.PrismaClient || prismaPkg.default?.PrismaClient;
  if (!PrismaClient) {
    throw new Error('PrismaClient não disponível. Execute npm install e npm run prisma:generate.');
  }
  return new PrismaClient({ log: ['error', 'warn'] });
}

function isPrismaPanic(error) {
  const name = String(error?.name || '');
  const message = String(error?.message || '');
  return name.includes('PrismaClientRustPanicError')
    || message.includes('PANIC: timer has gone away')
    || message.includes('This is a non-recoverable error');
}

export async function resetPrismaClient(reason = 'unknown') {
  const current = prismaClient;
  prismaClient = null;
  prismaLoadError = null;
  prismaLoadingPromise = null;
  if (current && typeof current.$disconnect === 'function') {
    try {
      await current.$disconnect();
    } catch {}
  }
  console.error(`[PRISMA_RESET] Cliente Prisma reinicializado. Motivo: ${reason}`);
}

export async function getPrismaClient() {
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

async function invokePath(pathParts = [], args = []) {
  const client = await getPrismaClient();
  let current = client;
  for (const part of pathParts) {
    current = current?.[part];
  }
  if (typeof current !== 'function') {
    throw new Error(`Operação Prisma inválida: ${pathParts.join('.')}`);
  }
  return current.apply(client, args);
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
          return await invokePath(pathParts, args);
        } catch (error) {
          if (!isPrismaPanic(error)) throw error;
          await resetPrismaClient(error?.message || 'panic');
          return invokePath(pathParts, args);
        }
      })();
    }
  });
}

export const prisma = createModelProxy();
