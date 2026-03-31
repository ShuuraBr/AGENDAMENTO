import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
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
  const encodedUser = encodeURIComponent(process.env.DB_USER);
  const encodedPass = encodeURIComponent(process.env.DB_PASS);

  process.env.DATABASE_URL =
    `mysql://${encodedUser}:${encodedPass}` +
    `@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  console.log('[boot] DATABASE_URL montada a partir de DB_*');
}

console.log('[boot] NODE_ENV =', process.env.NODE_ENV);
console.log('[boot] PORT(raw) =', process.env.PORT);
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

const PORT = Number(process.env.PORT) || 3000;
const fallbackApp = express();

fallbackApp.disable('x-powered-by');
fallbackApp.set('trust proxy', true);
fallbackApp.use(express.json({ limit: '10mb' }));
fallbackApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

const publicPath = path.join(__dirname, 'backend', 'public');
const indexPath = path.join(publicPath, 'index.html');

console.log('[boot] pasta pública =', publicPath);
console.log('[boot] indexPath =', indexPath);
console.log('[boot] public existe =', fs.existsSync(publicPath));
console.log('[boot] index existe =', fs.existsSync(indexPath));

if (fs.existsSync(publicPath)) {
  fallbackApp.use(express.static(publicPath));
}

fallbackApp.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, message: 'API online' });
});

fallbackApp.get('/debug-env', (_req, res) => {
  res.status(200).json({
    ok: true,
    nodeEnv: process.env.NODE_ENV || null,
    port: process.env.PORT || null,
    dbHost: process.env.DB_HOST || null,
    dbPort: process.env.DB_PORT || null,
    dbName: process.env.DB_NAME || null,
    dbUser: process.env.DB_USER || null,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    cwd: process.cwd(),
    __dirname
  });
});

let app = fallbackApp;

try {
  console.log('[boot] tentando importar ./backend/src/app.js ...');
  const backendModule = await import('./backend/src/app.js');
  console.log('[boot] chaves exportadas de app.js =', Object.keys(backendModule));

  const importedApp =
    backendModule?.default ||
    backendModule?.app ||
    backendModule?.server ||
    null;

  if (importedApp && typeof importedApp.use === 'function') {
    console.log('[boot] app Express real encontrado em backend/src/app.js');
    app = importedApp;

    app.disable?.('x-powered-by');
    app.set?.('trust proxy', true);

    app.get('/health', (_req, res) => {
      res.status(200).json({ ok: true, message: 'API online' });
    });

    app.get('/debug-env', (_req, res) => {
      res.status(200).json({
        ok: true,
        nodeEnv: process.env.NODE_ENV || null,
        port: process.env.PORT || null,
        dbHost: process.env.DB_HOST || null,
        dbPort: process.env.DB_PORT || null,
        dbName: process.env.DB_NAME || null,
        dbUser: process.env.DB_USER || null,
        hasDatabaseUrl: !!process.env.DATABASE_URL,
        cwd: process.cwd(),
        __dirname
      });
    });
  } else {
    console.error('[erro] backend/src/app.js foi importado, mas não exporta um app Express válido');
  }
} catch (err) {
  console.error('[erro] falha ao importar backend/src/app.js:', err);
}

fallbackApp.get('*', (req, res) => {
  try {
    console.log('[route] GET * ->', req.originalUrl, '=>', indexPath);

    if (!fs.existsSync(indexPath)) {
      return res.status(500).json({
        ok: false,
        error: 'index.html não encontrado',
        path: indexPath
      });
    }

    return res.sendFile(indexPath);
  } catch (err) {
    console.error('[erro] falha ao enviar index.html:', err);
    return res.status(500).json({
      ok: false,
      error: 'Falha ao carregar index.html',
      details: err?.message || String(err)
    });
  }
});

console.log('[boot] prestes a subir o express');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on('error', (err) => {
  console.error('[fatal] erro ao subir servidor:', err);
});