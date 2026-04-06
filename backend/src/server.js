import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Carregar variáveis de ambiente
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

// 2. Montar DATABASE_URL se necessário
if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

// 3. Importar o app só depois do ambiente pronto
const { default: app } = await import("./app.js");
const { syncLatestRelatorioToDatabase } = await import("./utils/relatorio-terceirizado.js");

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);

  const runRelatorioSync = async () => {
    try {
      const result = await syncLatestRelatorioToDatabase();
      if (result?.ok) {
        console.log(`[OK] Sincronização automática da planilha pronta. imported=${Boolean(result.imported)} total=${Number(result.totalRows || 0)} arquivo=${result.fileName || 'nenhum'}`);
      } else {
        console.warn(`[AVISO] Sincronização automática da planilha sem carga: ${result?.reason || 'sem detalhes'}`);
      }
    } catch (error) {
      console.error('[ERRO] Falha na sincronização automática da planilha:', error?.message || error);
    }
  };

  runRelatorioSync();
  const relatorioTimer = setInterval(runRelatorioSync, 60 * 1000);
  relatorioTimer.unref?.();
  console.log('[OK] Monitor automático da planilha de entradas ativado.');
});

server.on("error", (err) => {
  console.error("[ERRO] Falha ao iniciar:", err);
  process.exit(1);
});
