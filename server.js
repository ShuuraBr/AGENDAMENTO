import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('[boot] iniciando server.js raiz');
console.log('[boot] NODE_ENV =', process.env.NODE_ENV);
console.log('[boot] PORT(raw) =', process.env.PORT);
console.log('[boot] DB_HOST =', process.env.DB_HOST);
console.log('[boot] DB_PORT =', process.env.DB_PORT);
console.log('[boot] DB_NAME =', process.env.DB_NAME);
console.log('[boot] DB_USER =', process.env.DB_USER);
console.log('[boot] DATABASE_URL existe (antes) =', !!process.env.DATABASE_URL);

if (
  !process.env.DATABASE_URL &&
  process.env.DB_HOST &&
  process.env.DB_PORT &&
  process.env.DB_NAME &&
  process.env.DB_USER &&
  process.env.DB_PASS
) {
  const encodedPass = encodeURIComponent(process.env.DB_PASS);
  process.env.DATABASE_URL =
    `mysql://${process.env.DB_USER}:${encodedPass}` +
    `@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  console.log('[boot] DATABASE_URL montada a partir de DB_*');
}

console.log('[boot] DATABASE_URL existe (depois) =', !!process.env.DATABASE_URL);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.set('trust proxy', true);

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason);
});

app.use((req, _res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const publicPath = path.join(__dirname, 'backend', 'public');
const indexPath = path.join(publicPath, 'index.html');

console.log('[boot] pasta pública =', publicPath);
console.log('[boot] indexPath =', indexPath);
console.log('[boot] public existe =', fs.existsSync(publicPath));
console.log('[boot] index existe =', fs.existsSync(indexPath));

if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
} else {
  console.warn('[warn] pasta backend/public não encontrada');
}

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
    __dirname,
    publicExists: fs.existsSync(publicPath),
    indexExists: fs.existsSync(indexPath)
  });
});

app.get('*', (req, res) => {
  try {
    console.log('[route] GET * ->', req.originalUrl, '=>', indexPath);

    if (!fs.existsSync(indexPath)) {
      console.error('[erro] index.html não encontrado em:', indexPath);
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

app.use((err, _req, res, _next) => {
  console.error('[erro] middleware global:', err);
  res.status(500).json({
    ok: false,
    error: 'Erro interno no servidor',
    details: err?.message || String(err)
  });
});

console.log('[boot] prestes a subir o express');

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on('error', (err) => {
  console.error('[fatal] erro ao subir servidor:', err);
});