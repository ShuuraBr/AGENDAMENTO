import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";

const router = Router();
router.use(authRequired);

router.get("/operacional", async (_req, res) => {
  const [agendamentos, documentos] = await Promise.all([
    prisma.agendamento.findMany({ orderBy: { id: "desc" } }),
    prisma.documento.count()
  ]);

  const kpis = {
    total: agendamentos.length,
    pendentes: agendamentos.filter(x => x.status === "PENDENTE_APROVACAO").length,
    aprovados: agendamentos.filter(x => x.status === "APROVADO").length,
    emDescarga: agendamentos.filter(x => x.status === "EM_DESCARGA").length,
    finalizados: agendamentos.filter(x => x.status === "FINALIZADO").length,
    cancelados: agendamentos.filter(x => x.status === "CANCELADO").length,
    noShow: agendamentos.filter(x => x.status === "NO_SHOW").length,
    documentos
  };

  res.json({ kpis, agendamentos });
});

export default router;
