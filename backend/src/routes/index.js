import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import notificacoesRoutes from "./notificacoes.js";
import publicRoutes from "./public.js";
import webhookRoutes from "./webhook.js";
import { pingDatabase } from "../utils/db-fallback.js";
import { verifyMailTransport } from "../utils/email.js";
import { getUploadDirectoriesHealth } from "../utils/upload-policy.js";
import { getLogFilesHealth } from "../utils/telemetry.js";
import { authRequired } from "../middlewares/auth.js";
import { dispararRelatorioDiario, verificarEEnviarOptins } from "../utils/relatorio-supervisores.js";

const router = Router();

// Public health check – no sensitive information
router.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Detailed health checks require authentication
router.get("/health/db", authRequired, async (_req, res) => {
  try {
    await pingDatabase();
    res.json({ ok: true, message: "Banco online" });
  } catch (error) {
    console.error("Erro em /health/db:", error);
    res.status(500).json({ ok: false, message: "Falha no banco" });
  }
});
router.get("/health/smtp", authRequired, async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    res.status(smtp.ok ? 200 : 503).json({
      ok: smtp.ok,
      configured: smtp.configured,
      message: smtp.message,
    });
  } catch (error) {
    console.error("Erro em /health/smtp:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar SMTP." });
  }
});
router.get("/health/uploads", authRequired, (_req, res) => {
  try {
    const uploads = getUploadDirectoriesHealth();
    const logs = getLogFilesHealth();
    const safeUploads = uploads.map((u) => ({
      label: u.label,
      exists: u.exists,
      writable: u.writable,
    }));
    const safeLogs = logs.map((l) => ({
      file: l.file,
      exists: l.exists,
    }));
    res.json({ ok: true, uploads: safeUploads, logs: safeLogs });
  } catch (error) {
    console.error("Erro em /health/uploads:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar uploads." });
  }
});
router.get("/health/notifications", authRequired, async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    const uploads = getUploadDirectoriesHealth();
    const ok = !!smtp.ok && uploads.every((item) => item.exists && item.writable && item.readable);
    res.status(ok ? 200 : 503).json({
      ok,
      smtpOk: smtp.ok,
      uploadsOk: uploads.every((item) => item.exists && item.writable),
    });
  } catch (error) {
    console.error("Erro em /health/notifications:", error);
    res.status(500).json({ ok: false, message: "Falha ao consultar integrações de notificação." });
  }
});
// Disparo manual do relatório de supervisores (requer login)
router.post("/admin/relatorio-supervisores/disparar", authRequired, async (_req, res) => {
  try {
    await dispararRelatorioDiario();
    res.json({ ok: true, message: "Relatório disparado." });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

// Status do opt-in dos supervisores + reenvio da confirmação para pendentes
router.get("/admin/relatorio-supervisores/status", authRequired, async (_req, res) => {
  try {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(__dirname, "../../data/supervisores-optin.json");
    const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    res.json({ ok: true, state });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

router.post("/admin/relatorio-supervisores/reenviar-optin", authRequired, async (_req, res) => {
  try {
    await verificarEEnviarOptins();
    res.json({ ok: true, message: "Opt-in verificado/reenviado." });
  } catch (error) {
    res.status(500).json({ ok: false, message: error?.message || String(error) });
  }
});

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/notificacoes", notificacoesRoutes);
router.use("/public", publicRoutes);
router.use("/webhook", webhookRoutes);

export default router;