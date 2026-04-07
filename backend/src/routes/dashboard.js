import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { docaPainel } from "../utils/operations.js";
import { fetchAgendamentosRaw, fetchDocaPainelRaw } from "../utils/db-fallback.js";
import { readAgendamentos, readDocumentos, buildDocaPainelFromFiles } from "../utils/file-store.js";
import { withComputedTotals } from "../utils/agendamento-helpers.js";

const router = Router();
router.use(authRequired);

function filterItems(all, q = {}) {
  return all.filter((item) => {
    if (q.status && String(item.status || "") !== String(q.status)) return false;
    if (q.fornecedor && !String(item.fornecedor || "").toLowerCase().includes(String(q.fornecedor).toLowerCase())) return false;
    if (q.transportadora && !String(item.transportadora || "").toLowerCase().includes(String(q.transportadora).toLowerCase())) return false;
    if (q.motorista && !String(item.motorista || "").toLowerCase().includes(String(q.motorista).toLowerCase())) return false;
    if (q.placa && !String(item.placa || "").toLowerCase().includes(String(q.placa).toLowerCase())) return false;
    if (q.dataAgendada && String(item.dataAgendada || "") !== String(q.dataAgendada)) return false;
    return true;
  });
}

function buildKpis(all, docs, origem) {
  const enriched = all.map(withComputedTotals);
  return {
    total: enriched.length,
    pendentes: enriched.filter((x) => x.status === "PENDENTE_APROVACAO").length,
    aprovados: enriched.filter((x) => x.status === "APROVADO").length,
    chegou: enriched.filter((x) => x.status === "CHEGOU").length,
    emDescarga: enriched.filter((x) => x.status === "EM_DESCARGA").length,
    finalizados: enriched.filter((x) => x.status === "FINALIZADO").length,
    cancelados: enriched.filter((x) => x.status === "CANCELADO").length,
    noShow: enriched.filter((x) => x.status === "NO_SHOW").length,
    documentos: docs,
    volumes: enriched.reduce((a, b) => a + Number(b.quantidadeVolumes || 0), 0),
    pesoKg: Number(enriched.reduce((a, b) => a + Number(b.pesoTotalKg || 0), 0).toFixed(3)),
    valorTotal: Number(enriched.reduce((a, b) => a + Number(b.valorTotalNf || 0), 0).toFixed(2)),
    origem
  };
}

function parseDetalhes(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeLog(item = {}) {
  return {
    id: Number(item.id || 0) || null,
    usuarioId: Number(item.usuarioId || item.usuario?.id || 0) || null,
    usuarioNome: item.usuarioNome || item.usuario?.nome || null,
    usuarioEmail: item.usuarioEmail || item.usuario?.email || null,
    perfil: item.perfil || item.usuario?.perfil || null,
    acao: String(item.acao || "").trim(),
    entidade: String(item.entidade || "").trim(),
    entidadeId: item.entidadeId == null ? null : Number(item.entidadeId),
    detalhes: parseDetalhes(item.detalhes),
    ip: item.ip || null,
    createdAt: item.createdAt || null
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
    return res.json({ kpis: buildKpis(all, docs, "database"), agendamentos: agendamentos.map(withComputedTotals), painelDocas });
  } catch (error) {
    console.error("Erro em /dashboard/operacional. Tentando fallback SQL/arquivo:", error?.message || error);
    try {
      const [agendamentos, painelDocas] = await Promise.all([fetchAgendamentosRaw(q), fetchDocaPainelRaw(q.dataAgendada || null)]);
      return res.json({
        kpis: buildKpis(agendamentos, 0, "database-raw"),
        agendamentos: agendamentos.map(withComputedTotals),
        painelDocas
      });
    } catch (rawError) {
      console.error("Erro no fallback SQL de /dashboard/operacional. Usando arquivo:", rawError?.message || rawError);
      const all = readAgendamentos();
      return res.json({ kpis: buildKpis(all, readDocumentos().length, "arquivo"), agendamentos: filterItems(all, q), painelDocas: buildDocaPainelFromFiles(q.dataAgendada || null) });
    }
  }
});

router.get("/docas", async (req, res) => {
  try {
    return res.json(await docaPainel(req.query?.dataAgendada || null));
  } catch (error) {
    console.error("Erro em /dashboard/docas. Tentando fallback SQL/arquivo:", error?.message || error);
    try {
      return res.json(await fetchDocaPainelRaw(req.query?.dataAgendada || null));
    } catch (rawError) {
      console.error("Erro no fallback SQL de /dashboard/docas. Usando arquivo:", rawError?.message || rawError);
      return res.json(buildDocaPainelFromFiles(req.query?.dataAgendada || null));
    }
  }
});

router.get("/logs", async (req, res) => {
  const limit = Math.max(10, Math.min(300, Number(req.query?.limit || 80)));
  const entidade = String(req.query?.entidade || "").trim();
  const acao = String(req.query?.acao || "").trim();
  const entidadeId = req.query?.entidadeId == null || req.query?.entidadeId === "" ? null : Number(req.query.entidadeId);

  try {
    const items = await prisma.logAuditoria.findMany({
      where: {
        ...(entidade ? { entidade } : {}),
        ...(acao ? { acao } : {}),
        ...(entidadeId != null && Number.isFinite(entidadeId) ? { entidadeId } : {})
      },
      include: { usuario: true },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return res.json(items.map(normalizeLog));
  } catch (error) {
    console.error("Erro em /dashboard/logs:", error?.message || error);
    return res.json([]);
  }
});

export default router;
