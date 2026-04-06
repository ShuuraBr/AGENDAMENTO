import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const candidates = [
  path.join(__dirname, 'backend', 'src', 'server.js'),
  path.join(__dirname, 'src', 'server.js')
];

const entry = candidates.find((item) => fs.existsSync(item));

if (!entry) {
  console.error('[FATAL] Nenhum entrypoint encontrado. Esperado: backend/src/server.js ou src/server.js');
  process.exit(1);
}

import(pathToFileURL(entry).href)
  .then(() => {
    console.log(`[OK] Backend iniciado via ${path.relative(__dirname, entry)}`);
  })
  .catch((err) => {
    console.error('[FATAL] Erro ao iniciar backend:', err);
    process.exit(1);
  });
