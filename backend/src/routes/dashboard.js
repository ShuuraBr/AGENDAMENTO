import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { docaPainel } from "../utils/operations.js";
import { readAgendamentos, readDocumentos, buildDocaPainelFromFiles } from "../utils/file-store.js";

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

  try {
    const [agendamentos, docs, all, painelDocas] = await Promise.all([
      prisma.agendamento.findMany({
        where,
        include: { notasFiscais: true, documentos: true, doca: true, janela: true },
        orderBy: { id: "desc" }
      }),
      prisma.documento.count(),
      prisma.agendamento.findMany(),
      docaPainel(q.dataAgendada || null)
    ]);

    const kpis = {
      total: all.length,
      pendentes: all.filter(x => x.status === "PENDENTE_APROVACAO").length,
      aprovados: all.filter(x => x.status === "APROVADO").length,
      chegou: all.filter(x => x.status === "CHEGOU").length,
      emDescarga: all.filter(x => x.status === "EM_DESCARGA").length,
      finalizados: all.filter(x => x.status === "FINALIZADO").length,
      cancelados: all.filter(x => x.status === "CANCELADO").length,
      noShow: all.filter(x => x.status === "NO_SHOW").length,
      documentos: docs,
      origem: 'database'
    };

    return res.json({ kpis, agendamentos, painelDocas });
  } catch (error) {
    console.error('Erro em /dashboard/operacional. Usando fallback em arquivo:', error?.message || error);
    const all = readAgendamentos();
    const filtered = all.filter((item) => {
      if (q.status && String(item.status || '') !== String(q.status)) return false;
      if (q.fornecedor && !String(item.fornecedor || '').toLowerCase().includes(String(q.fornecedor).toLowerCase())) return false;
      if (q.transportadora && !String(item.transportadora || '').toLowerCase().includes(String(q.transportadora).toLowerCase())) return false;
      if (q.motorista && !String(item.motorista || '').toLowerCase().includes(String(q.motorista).toLowerCase())) return false;
      if (q.placa && !String(item.placa || '').toLowerCase().includes(String(q.placa).toLowerCase())) return false;
      if (q.dataAgendada && String(item.dataAgendada || '') !== String(q.dataAgendada)) return false;
      return true;
    });
    const kpis = {
      total: all.length,
      pendentes: all.filter(x => x.status === "PENDENTE_APROVACAO").length,
      aprovados: all.filter(x => x.status === "APROVADO").length,
      chegou: all.filter(x => x.status === "CHEGOU").length,
      emDescarga: all.filter(x => x.status === "EM_DESCARGA").length,
      finalizados: all.filter(x => x.status === "FINALIZADO").length,
      cancelados: all.filter(x => x.status === "CANCELADO").length,
      noShow: all.filter(x => x.status === "NO_SHOW").length,
      documentos: readDocumentos().length,
      origem: 'arquivo'
    };
    return res.json({ kpis, agendamentos: filtered, painelDocas: buildDocaPainelFromFiles(q.dataAgendada || null) });
  }
});

router.get("/docas", async (req, res) => {
  try {
    res.json(await docaPainel(req.query?.dataAgendada || null));
  } catch (error) {
    console.error('Erro em /dashboard/docas. Usando fallback em arquivo:', error?.message || error);
    res.json(buildDocaPainelFromFiles(req.query?.dataAgendada || null));
  }
});

export default router;
