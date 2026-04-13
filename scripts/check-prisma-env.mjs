import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const envCandidates = [path.join(root, '.env'), path.join(root, 'backend', '.env')];
for (const file of envCandidates) {
  if (fs.existsSync(file)) dotenv.config({ path: file, override: true });
}
const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASS'];
const missing = required.filter((key) => !String(process.env[key] || '').trim());
if (missing.length) {
  console.log(`[WARN] Variáveis ausentes para Prisma/MySQL: ${missing.join(', ')}`);
  process.exit(0);
}
console.log('[OK] Variáveis de banco presentes.');
