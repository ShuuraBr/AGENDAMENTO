import { Router } from "express";
import authRoutes from "./auth.js";
import dashboardRoutes from "./dashboard.js";
import agendamentoRoutes from "./agendamentos.js";
import publicRoutes from "./public.js";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ ok: true, message: "API online" });
});

router.use("/auth", authRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/agendamentos", agendamentoRoutes);
router.use("/public", publicRoutes);

export default router;
