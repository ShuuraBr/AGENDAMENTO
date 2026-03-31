import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

console.log('[boot] iniciando server.js raiz');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootEnvPath = path.join(__dirname, '.env');
const backendEnvPath = path.join(__dirname, 'backend', '.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
  console.log('[boot] .env da raiz carregado');
} else {
  console.log('[boot] .env da raiz não encontrado');
}

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: false });
  console.log('[boot] .env do backend encontrado');
} else {
  console.log('[boot] .env do backend não encontrado');
}

if (
  !process.env.DATABASE_URL &&
  process.env.DB_HOST &&
  process.env.DB_PORT &&
  process.env.DB_NAME &&
  process.env.DB_USER &&
  process.env.DB_PASS
) {
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}` +
    `@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  console.log('[boot] DATABASE_URL montada a partir de DB_*');
}

console.log('[boot] NODE_ENV =', process.env.NODE_ENV);
console.log('[boot] PORT =', process.env.PORT);
console.log('[boot] DB_HOST =', process.env.DB_HOST);
console.log('[boot] DB_PORT =', process.env.DB_PORT);
console.log('[boot] DB_NAME =', process.env.DB_NAME);
console.log('[boot] DB_USER =', process.env.DB_USER);
console.log('[boot] DATABASE_URL existe =', !!process.env.DATABASE_URL);

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

console.log('[boot] carregando backend/src/app.js ...');

const { default: app } = await import('./backend/src/app.js');

const PORT = Number(process.env.PORT) || 3000;

console.log('[boot] prestes a subir o express');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on('error', (err) => {
  console.error('[fatal] erro ao subir servidor:', err);
  process.exit(1);
});