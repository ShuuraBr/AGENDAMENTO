import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { readCollection } from "../utils/store.js";

const router = Router();
router.use(authRequired);

router.get("/operacional", (_req, res) => {
  const agendamentos = readCollection("agendamentos");
  const documentos = readCollection("documentos");

  const kpis = {
    total: agendamentos.length,
    pendentes: agendamentos.filter(x => x.status === "PENDENTE_APROVACAO").length,
    aprovados: agendamentos.filter(x => x.status === "APROVADO").length,
    emDescarga: agendamentos.filter(x => x.status === "EM_DESCARGA").length,
    finalizados: agendamentos.filter(x => x.status === "FINALIZADO").length,
    cancelados: agendamentos.filter(x => x.status === "CANCELADO").length,
    noShow: agendamentos.filter(x => x.status === "NO_SHOW").length,
    documentos: documentos.length
  };

  res.json({ kpis, agendamentos });
});

export default router;
