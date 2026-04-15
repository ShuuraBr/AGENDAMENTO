import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

const { default: app } = await import("./app.js");
const { startRelatorioImportWatcher } = await import("./utils/relatorio-entradas.js");

const PORT = Number(process.env.PORT || 3000);
const shouldStartWatcher = ['1', 'true', 'yes', 'on'].includes(String(process.env.RELATORIO_IMPORT_WATCHER || '0').toLowerCase());

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
  if (shouldStartWatcher) {
    try {
      startRelatorioImportWatcher();
      console.log('[OK] Monitor automático da planilha de entradas ativado.');
    } catch (error) {
      console.error('[WARN] Falha ao ativar monitor da planilha de entradas:', error?.message || error);
    }
  } else {
    console.log('[OK] Monitor automático da planilha de entradas desativado por configuração.');
  }
});

server.on("error", (err) => {
  console.error("[ERRO] Falha ao iniciar:", err);
  process.exit(1);
});
