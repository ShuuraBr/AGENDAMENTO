import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const envPath = path.join(backendRoot, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });

const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());
if (missing.length) {
  console.log(`[WARN] Variáveis ausentes para Prisma/MySQL: ${missing.join(', ')}`);
  process.exit(0);
}
console.log('[OK] Variáveis de banco presentes.');
