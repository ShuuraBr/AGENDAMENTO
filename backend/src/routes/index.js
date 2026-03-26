import { Router } from "express";
import authRoutes from "../modules/auth/routes.js";
import unidadesRoutes from "../modules/unidades/routes.js";
import docasRoutes from "../modules/docas/routes.js";
import janelasRoutes from "../modules/janelas/routes.js";
import regrasRoutes from "../modules/regras/routes.js";
import fornecedoresRoutes from "../modules/fornecedores/routes.js";
import transportadorasRoutes from "../modules/transportadoras/routes.js";
import motoristasRoutes from "../modules/motoristas/routes.js";
import veiculosRoutes from "../modules/veiculos/routes.js";
import agendamentosRoutes from "../modules/agendamentos/routes.js";
import dashboardRoutes from "../modules/dashboard/routes.js";
import publicRoutes from "../modules/public/routes.js";

const router = Router();

router.get("/health", (_req, res) => res.json({ ok: true, message: "API online" }));
router.use("/public", publicRoutes);
router.use("/auth", authRoutes);
router.use("/unidades", unidadesRoutes);
router.use("/docas", docasRoutes);
router.use("/janelas", janelasRoutes);
router.use("/regras", regrasRoutes);
router.use("/fornecedores", fornecedoresRoutes);
router.use("/transportadoras", transportadorasRoutes);
router.use("/motoristas", motoristasRoutes);
router.use("/veiculos", veiculosRoutes);
router.use("/agendamentos", agendamentosRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
