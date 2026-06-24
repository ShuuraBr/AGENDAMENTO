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
const { runVoucherConfirmationWatcherTick } = await import("./utils/whatsapp-voucher-confirmation.js");
const { iniciarSchedulerRelatorio, verificarEEnviarOptins } = await import("./utils/relatorio-supervisores.js");

const PORT = Number(process.env.PORT || 3000);
const shouldStartWatcher = ['1', 'true', 'yes', 'on'].includes(String(process.env.RELATORIO_IMPORT_WATCHER || '0').toLowerCase());

const WHATSAPP_CONFIRMACAO_WATCH_INTERVAL_MS = 60 * 1000;

function startWhatsAppConfirmationWatcher() {
  const tick = () => {
    runVoucherConfirmationWatcherTick().catch((error) => {
      console.error('Falha na verificação de confirmações de WhatsApp pendentes:', error?.message || error);
    });
  };
  tick();
  const handle = setInterval(tick, WHATSAPP_CONFIRMACAO_WATCH_INTERVAL_MS);
  handle.unref?.();
  return handle;
}

const server = app.listen(PORT, "0.0.0.0", async () => {
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

  try {
    startWhatsAppConfirmationWatcher();
    console.log('[OK] Monitor de confirmação de voucher via WhatsApp ativado.');
  } catch (error) {
    console.error('[WARN] Falha ao ativar monitor de confirmação de voucher via WhatsApp:', error?.message || error);
  }

  try {
    await verificarEEnviarOptins();
    console.log('[OK] Verificação de opt-in de supervisores concluída.');
  } catch (error) {
    console.error('[WARN] Falha ao verificar opt-in de supervisores:', error?.message || error);
  }

  try {
    iniciarSchedulerRelatorio();
    console.log('[OK] Scheduler de relatório diário para supervisores ativado (07:30 BRT).');
  } catch (error) {
    console.error('[WARN] Falha ao ativar scheduler de relatório diário:', error?.message || error);
  }
});

server.on("error", (err) => {
  console.error("[ERRO] Falha ao iniciar:", err);
  process.exit(1);
});