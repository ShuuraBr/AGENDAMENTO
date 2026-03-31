import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import publicRoutes from "./public.js";
import relatorioTerceirizadoRoutes from "./relatorio-terceirizado.js";
import { pingDatabase } from "../utils/db-fallback.js";

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
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/public", publicRoutes);
router.use("/relatorio-terceirizado", relatorioTerceirizadoRoutes);

export default router;
