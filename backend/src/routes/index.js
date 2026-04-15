import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import publicRoutes from "./public.js";
import { pingDatabase } from "../utils/db-fallback.js";
import { verifyMailTransport } from "../utils/email.js";
import { getUploadDirectoriesHealth } from "../utils/upload-policy.js";
import { getLogFilesHealth } from "../utils/telemetry.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, message: "API online" }));
router.get("/health/db", async (_req, res) => {
  try {
    const db = await pingDatabase();
    res.json({ ok: true, message: "Banco online", db });
  } catch (error) {
    console.error("Erro em /health/db:", error);
    res.status(500).json({ ok: false, message: error?.message || "Falha no banco" });
  }
});
router.get("/health/smtp", async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    res.status(smtp.ok ? 200 : 503).json(smtp);
  } catch (error) {
    console.error("Erro em /health/smtp:", error);
    res.status(500).json({ ok: false, message: error?.message || "Falha ao consultar SMTP." });
  }
});
router.get("/health/uploads", (_req, res) => {
  try {
    const uploads = getUploadDirectoriesHealth();
    const logs = getLogFilesHealth();
    res.json({ ok: true, uploads, logs });
  } catch (error) {
    console.error("Erro em /health/uploads:", error);
    res.status(500).json({ ok: false, message: error?.message || "Falha ao consultar uploads." });
  }
});
router.get("/health/notifications", async (_req, res) => {
  try {
    const smtp = await verifyMailTransport();
    const uploads = getUploadDirectoriesHealth();
    const logs = getLogFilesHealth();
    const ok = !!smtp.ok && uploads.every((item) => item.exists && item.writable && item.readable);
    res.status(ok ? 200 : 503).json({ ok, smtp, uploads, logs });
  } catch (error) {
    console.error("Erro em /health/notifications:", error);
    res.status(500).json({ ok: false, message: error?.message || "Falha ao consultar integrações de notificação." });
  }
});
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/public", publicRoutes);

export default router;
