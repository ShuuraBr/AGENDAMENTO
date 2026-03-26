import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authRequired } from "../../middlewares/auth.js";

const router = Router();
router.use(authRequired);

router.get("/operacional", async (_req, res) => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const [pendentes, aprovados, finalizados, cancelados, docasAtivas, janelasHoje] = await Promise.all([
    prisma.agendamento.count({ where: { status: "PENDENTE_APROVACAO" } }),
    prisma.agendamento.count({ where: { status: "APROVADO" } }),
    prisma.agendamento.count({ where: { status: "FINALIZADO" } }),
    prisma.agendamento.count({ where: { status: "CANCELADO" } }),
    prisma.doca.count({ where: { ativa: true } }),
    prisma.janelaAgendamento.findMany({
      where: { dataAgendamento: start },
      orderBy: [{ horaInicio: "asc" }]
    })
  ]);

  res.json({ kpis: { pendentes, aprovados, finalizados, cancelados, docasAtivas }, janelasHoje });
});

export default router;
