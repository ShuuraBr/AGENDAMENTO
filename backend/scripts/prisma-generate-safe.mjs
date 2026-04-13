import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..');
const schemaPath = path.join(backendRoot, 'prisma', 'schema.prisma');
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');

const result = spawnSync(process.execPath, [prismaCli, 'generate', `--schema=${schemaPath}`], {
  cwd: backendRoot,
  stdio: 'inherit'
});

if (result.status !== 0) {
  console.warn('[WARN] prisma generate falhou. O deploy seguirá em modo tolerante.');
  process.exit(0);
}
