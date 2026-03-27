import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { readCollection } from "../utils/store.js";

const router = Router();
router.use(authRequired);

router.get("/operacional", (_req, res) => {
  const agendamentos = readCollection("agendamentos");
  const docs = readCollection("documentos");

  const kpis = {
    total: agendamentos.length,
    pendentes: agendamentos.filter(a => a.status === "PENDENTE_APROVACAO").length,
    aprovados: agendamentos.filter(a => a.status === "APROVADO").length,
    cancelados: agendamentos.filter(a => a.status === "CANCELADO").length,
    finalizados: agendamentos.filter(a => a.status === "FINALIZADO").length,
    documentos: docs.length
  };

  res.json({ kpis, agendamentos });
});

export default router;
