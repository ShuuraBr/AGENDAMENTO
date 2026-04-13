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

let mysqlModulePromise = null;
let mysqlPoolPromise = null;

function envTruthy(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function ensureDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '3306';
  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const pass = process.env.DB_PASS;
  if (!host || !name || !user) return '';
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@${host}:${port}/${name}`;
  return process.env.DATABASE_URL;
}

function getMysqlConfig() {
  const url = ensureDatabaseUrl();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!parsed.hostname || !database || !parsed.username) return null;
    return {
      host: parsed.hostname,
      port: Number(parsed.port || 3306),
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password || ''),
      database,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_DIRECT_POOL_LIMIT || 5),
      queueLimit: 0,
      namedPlaceholders: false,
      timezone: 'Z'
    };
  } catch {
    return null;
  }
}

export function isDirectMysqlEnabled() {
  if (envTruthy(process.env.MYSQL_DIRECT_DISABLED, false)) return false;
  return Boolean(getMysqlConfig());
}

async function loadMysqlModule() {
  if (!mysqlModulePromise) {
    mysqlModulePromise = import('mysql2/promise')
      .then((mod) => mod.default || mod)
      .catch((error) => {
        mysqlModulePromise = null;
        throw new Error(`mysql2 indisponível: ${error?.message || error}`);
      });
  }
  return mysqlModulePromise;
}

export async function getMysqlPool() {
  if (!isDirectMysqlEnabled()) {
    throw new Error('MySQL direto indisponível: variáveis de ambiente não configuradas.');
  }
  if (!mysqlPoolPromise) {
    mysqlPoolPromise = (async () => {
      const mysql = await loadMysqlModule();
      const pool = mysql.createPool(getMysqlConfig());
      await pool.query('SELECT 1');
      return pool;
    })().catch((error) => {
      mysqlPoolPromise = null;
      throw error;
    });
  }
  return mysqlPoolPromise;
}

export async function queryMysql(sql, params = []) {
  const pool = await getMysqlPool();
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function executeMysql(sql, params = []) {
  const pool = await getMysqlPool();
  const [result] = await pool.execute(sql, params);
  return result;
}

export async function closeMysqlPool() {
  if (!mysqlPoolPromise) return;
  try {
    const pool = await mysqlPoolPromise;
    await pool.end();
  } catch {}
  mysqlPoolPromise = null;
}
