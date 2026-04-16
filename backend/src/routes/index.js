import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import publicRoutes from "./public.js";
import { authRequired } from "../middlewares/auth.js";
import { pingDatabase } from "../utils/db-fallback.js";
import { verifyMailTransport } from "../utils/email.js";
import { getUploadDirectoriesHealth } from "../utils/upload-policy.js";
import { getLogFilesHealth } from "../utils/telemetry.js";

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
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/public", publicRoutes);

export default router;
