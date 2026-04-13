import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const schemaPath = path.join(root, 'backend', 'prisma', 'schema.prisma');
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');

const result = spawnSync(process.execPath, [prismaCli, 'generate', `--schema=${schemaPath}`], {
  cwd: root,
  stdio: 'inherit'
});

if (result.status !== 0) {
  console.warn('[WARN] prisma generate falhou. O deploy seguirá em modo tolerante.');
  process.exit(0);
}
