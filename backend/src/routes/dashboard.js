import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";

const router = Router();
router.use(authRequired);

router.get("/operacional", async (req, res) => {
  const q = req.query || {};
  const where = {
    ...(q.status ? { status: String(q.status) } : {}),
    ...(q.fornecedor ? { fornecedor: { contains: String(q.fornecedor) } } : {}),
    ...(q.transportadora ? { transportadora: { contains: String(q.transportadora) } } : {}),
    ...(q.motorista ? { motorista: { contains: String(q.motorista) } } : {}),
    ...(q.placa ? { placa: { contains: String(q.placa) } } : {}),
    ...(q.dataAgendada ? { dataAgendada: String(q.dataAgendada) } : {})
  };

  const [agendamentos, docs] = await Promise.all([
    prisma.agendamento.findMany({
      where,
      include: { notasFiscais: true, documentos: true },
      orderBy: { id: "desc" }
    }),
    prisma.documento.count()
  ]);

  const all = await prisma.agendamento.findMany();

  const kpis = {
    total: all.length,
    pendentes: all.filter(x => x.status === "PENDENTE_APROVACAO").length,
    aprovados: all.filter(x => x.status === "APROVADO").length,
    chegou: all.filter(x => x.status === "CHEGOU").length,
    emDescarga: all.filter(x => x.status === "EM_DESCARGA").length,
    finalizados: all.filter(x => x.status === "FINALIZADO").length,
    cancelados: all.filter(x => x.status === "CANCELADO").length,
    noShow: all.filter(x => x.status === "NO_SHOW").length,
    documentos: docs
  };

  res.json({ kpis, agendamentos });
});

export default router;
