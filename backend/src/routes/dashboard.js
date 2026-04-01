import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { docaPainel } from "../utils/operations.js";
import { readAgendamentos, readDocumentos, buildDocaPainelFromFiles } from "../utils/file-store.js";
import { withComputedTotals } from "../utils/agendamento-helpers.js";

const router = Router();
router.use(authRequired);

function filterItems(all, q = {}) {
  return all.filter((item) => {
    if (q.status && String(item.status || '') !== String(q.status)) return false;
    if (q.fornecedor && !String(item.fornecedor || '').toLowerCase().includes(String(q.fornecedor).toLowerCase())) return false;
    if (q.transportadora && !String(item.transportadora || '').toLowerCase().includes(String(q.transportadora).toLowerCase())) return false;
    if (q.motorista && !String(item.motorista || '').toLowerCase().includes(String(q.motorista).toLowerCase())) return false;
    if (q.placa && !String(item.placa || '').toLowerCase().includes(String(q.placa).toLowerCase())) return false;
    if (q.dataAgendada && String(item.dataAgendada || '') !== String(q.dataAgendada)) return false;
    return true;
  });
}

function buildKpis(all, docs, origem) {
  const enriched = all.map(withComputedTotals);
  return {
    total: enriched.length,
    pendentes: enriched.filter(x => x.status === "PENDENTE_APROVACAO").length,
    aprovados: enriched.filter(x => x.status === "APROVADO").length,
    chegou: enriched.filter(x => x.status === "CHEGOU").length,
    emDescarga: enriched.filter(x => x.status === "EM_DESCARGA").length,
    finalizados: enriched.filter(x => x.status === "FINALIZADO").length,
    cancelados: enriched.filter(x => x.status === "CANCELADO").length,
    noShow: enriched.filter(x => x.status === "NO_SHOW").length,
    documentos: docs,
    volumes: enriched.reduce((a, b) => a + Number(b.quantidadeVolumes || 0), 0),
    pesoKg: Number(enriched.reduce((a, b) => a + Number(b.pesoTotalKg || 0), 0).toFixed(3)),
    valorTotal: Number(enriched.reduce((a, b) => a + Number(b.valorTotalNf || 0), 0).toFixed(2)),
    origem
  };
}

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
      prisma.agendamento.findMany({ where, include: { notasFiscais: true, documentos: true, doca: true, janela: true }, orderBy: { id: "desc" } }),
      prisma.documento.count(),
      prisma.agendamento.findMany({ include: { notasFiscais: true } }),
      docaPainel(q.dataAgendada || null)
    ]);
    return res.json({ kpis: buildKpis(all, docs, 'database'), agendamentos: agendamentos.map(withComputedTotals), painelDocas });
  } catch (error) {
    console.error('Erro em /dashboard/operacional. Usando fallback em arquivo:', error?.message || error);
    const all = readAgendamentos();
    return res.json({ kpis: buildKpis(all, readDocumentos().length, 'arquivo'), agendamentos: filterItems(all, q), painelDocas: buildDocaPainelFromFiles(q.dataAgendada || null) });
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
