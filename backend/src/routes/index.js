import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import cadastrosRoutes from "./cadastros.js";
import agendamentosRoutes from "./agendamentos.js";
import publicRoutes from "./public.js";
import { pingDatabase } from "../utils/db-fallback.js";
import { normalizeDatabaseError } from "../utils/db-error.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, message: "API online" }));
router.get("/health/db", async (_req, res) => {
  try {
    const db = await pingDatabase();
    res.json({ ok: true, message: "Banco online", db });
  } catch (error) {
    const normalizedError = normalizeDatabaseError(error);
    console.error("Erro em /health/db:", normalizedError);
    res.status(normalizedError.statusCode || 500).json({ ok: false, message: normalizedError.message || "Falha no banco" });
  }
});
router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/cadastros", cadastrosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/public", publicRoutes);

export default router;
