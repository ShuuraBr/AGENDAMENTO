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
let prismaDisabled = String(process.env.PRISMA_DISABLED || '').trim() === '1';
let prismaDisableReason = prismaDisabled ? 'PRISMA_DISABLED=1' : null;
const loggedDisableReasons = new Set();

function createPrismaDisabledError(context = 'Prisma') {
  const reason = prismaDisableReason || 'Prisma desabilitado';
  const error = new Error(`${context}: ${reason}`);
  error.code = 'PRISMA_DISABLED';
  error.isPrismaDisabled = true;
  return error;
}

function logDisableOnce(reason) {
  const key = String(reason || 'motivo_desconhecido');
  if (loggedDisableReasons.has(key)) return;
  loggedDisableReasons.add(key);
  console.error(`[PRISMA_DISABLED] ${key}`);
}

async function createPrismaClient() {
  if (prismaDisabled) throw createPrismaDisabledError('Prisma indisponível');
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

export function isPrismaDisabled() {
  return prismaDisabled;
}

export function getPrismaDisableReason() {
  return prismaDisableReason;
}

export function isPrismaDisabledError(error) {
  return Boolean(error?.isPrismaDisabled || error?.code === 'PRISMA_DISABLED' || String(error?.message || '').includes('Prisma desabilitado'));
}

export async function disablePrismaClient(reason = 'Prisma desabilitado manualmente') {
  prismaDisabled = true;
  prismaDisableReason = String(reason || 'Prisma desabilitado manualmente');
  logDisableOnce(prismaDisableReason);
  const current = prismaClient;
  prismaClient = null;
  prismaLoadingPromise = null;
  prismaLoadError = createPrismaDisabledError('Prisma desabilitado');
  if (current && typeof current.$disconnect === 'function') {
    try { await current.$disconnect(); } catch {}
  }
}

export async function resetPrismaClient() {
  const current = prismaClient;
  prismaClient = null;
  prismaLoadError = null;
  prismaLoadingPromise = null;
  if (current && typeof current.$disconnect === 'function') {
    try { await current.$disconnect(); } catch {}
  }
}

export async function getPrismaClient() {
  if (prismaDisabled) throw createPrismaDisabledError('Prisma desabilitado');
  if (prismaClient) return prismaClient;
  if (prismaLoadError) throw prismaLoadError;
  if (!prismaLoadingPromise) {
    prismaLoadingPromise = createPrismaClient()
      .then((client) => {
        prismaClient = client;
        return client;
      })
      .catch((error) => {
        if (isPrismaEnginePanic(error)) {
          prismaDisabled = true;
          prismaDisableReason = `Prisma desabilitado após panic do engine: ${error?.message || error}`;
          logDisableOnce(prismaDisableReason);
          prismaLoadError = createPrismaDisabledError('Prisma desabilitado');
          throw prismaLoadError;
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
        if (prismaDisabled) {
          throw createPrismaDisabledError(`Prisma desabilitado em ${pathParts.join('.') || 'operação'}`);
        }

        const execute = async () => {
          const client = await getPrismaClient();
          let current = client;
          for (const part of pathParts) {
            current = current?.[part];
          }
          if (typeof current !== 'function') {
            throw new Error(`Operação Prisma inválida: ${pathParts.join('.')}`);
          }
          return current.apply(client, args);
        };

        try {
          return await execute();
        } catch (error) {
          if (!isPrismaEnginePanic(error)) throw error;
          await disablePrismaClient(`Prisma desabilitado após panic do engine: ${error?.message || error}`);
          throw createPrismaDisabledError(`Prisma desabilitado em ${pathParts.join('.') || 'operação'}`);
        }
      })();
    }
  });
}

export const prisma = createModelProxy();
