import { Router } from "express";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { docaPainel, trafficColor } from "../utils/operations.js";
import { fetchAgendamentosRaw, fetchDocaPainelRaw } from "../utils/db-fallback.js";
import { readAgendamentos, readDocumentos, buildDocaPainelFromFiles, readLogsAuditoria, readUsuarios } from "../utils/file-store.js";
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

function withStatusMeta(item = {}) {
  return { ...item, semaforo: trafficColor(item.status) };
}

function buildKpis(all, docs) {
  const enriched = all.map(withComputedTotals);
  return {
    total: enriched.length,
<<<<<<< HEAD
    pendentes: enriched.filter(x => x.status === "PENDENTE_APROVACAO").length,
    aprovados: enriched.filter(x => x.status === "APROVADO").length,
    chegou: enriched.filter(x => x.status === "CHEGOU").length,
    emDescarga: enriched.filter(x => x.status === "EM_DESCARGA").length,
    finalizados: enriched.filter(x => x.status === "FINALIZADO").length,
    cancelados: enriched.filter(x => x.status === "CANCELADO").length,
    noShow: enriched.filter(x => x.status === "NO_SHOW").length,
    pesoKg: Number(enriched.reduce((a, b) => a + Number(b.pesoTotalKg || 0), 0).toFixed(3)),
    valorTotal: Number(enriched.reduce((a, b) => a + Number(b.valorTotalNf || 0), 0).toFixed(2))
=======
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
    valorTotal: Number(enriched.reduce((a, b) => a + Number(b.valorTotalNf || 0), 0).toFixed(2))
  };
}

function parseDetalhes(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return { raw: String(value) };
  }
}

function normalizeAuditLog(item = {}, usersById = new Map()) {
  const usuarioId = item.usuarioId != null ? Number(item.usuarioId) : null;
  const usuario = item.usuario || (usuarioId ? usersById.get(usuarioId) : null) || null;
  return {
    id: item.id,
    createdAt: item.createdAt,
    acao: item.acao,
    entidade: item.entidade,
    entidadeId: item.entidadeId != null ? Number(item.entidadeId) : null,
    perfil: item.perfil || usuario?.perfil || null,
    ip: item.ip || null,
    usuarioId,
    usuarioNome: usuario?.nome || null,
    usuarioEmail: usuario?.email || null,
    detalhes: parseDetalhes(item.detalhes)
>>>>>>> e5083df4985759e952079d5f891cc01c38f2a41d
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
    return res.json({
      kpis: buildKpis(all, docs),
      agendamentos: agendamentos.map((item) => withStatusMeta(withComputedTotals(item))),
      painelDocas
    });
  } catch (error) {
    console.error('Erro em /dashboard/operacional. Tentando fallback SQL/arquivo:', error?.message || error);
    try {
      const [agendamentos, painelDocas] = await Promise.all([
        fetchAgendamentosRaw(q),
        fetchDocaPainelRaw(q.dataAgendada || null)
      ]);
      return res.json({
        kpis: buildKpis(agendamentos, 0),
        agendamentos: agendamentos.map((item) => withStatusMeta(withComputedTotals(item))),
        painelDocas
      });
    } catch (rawError) {
      console.error('Erro no fallback SQL de /dashboard/operacional. Usando arquivo:', rawError?.message || rawError);
      const all = readAgendamentos();
      return res.json({
        kpis: buildKpis(all, readDocumentos().length),
        agendamentos: filterItems(all, q).map(withStatusMeta),
        painelDocas: buildDocaPainelFromFiles(q.dataAgendada || null)
      });
    }
  }
});

router.get("/docas", async (req, res) => {
  try {
    return res.json(await docaPainel(req.query?.dataAgendada || null));
  } catch (error) {
    console.error('Erro em /dashboard/docas. Tentando fallback SQL/arquivo:', error?.message || error);
    try {
      return res.json(await fetchDocaPainelRaw(req.query?.dataAgendada || null));
    } catch (rawError) {
      console.error('Erro no fallback SQL de /dashboard/docas. Usando arquivo:', rawError?.message || rawError);
      return res.json(buildDocaPainelFromFiles(req.query?.dataAgendada || null));
    }
  }
});

router.get("/auditoria", requireProfiles("ADMIN"), async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query?.limit || 200)));
  const entidadeId = req.query?.entidadeId ? Number(req.query.entidadeId) : null;
  const entidade = req.query?.entidade ? String(req.query.entidade) : null;

  try {
    const rows = await prisma.logAuditoria.findMany({
      where: {
        ...(entidade ? { entidade } : {}),
        ...(entidadeId ? { entidadeId } : {})
      },
      include: { usuario: true },
      orderBy: { createdAt: "desc" },
      take: limit
    });
    return res.json(rows.map((row) => normalizeAuditLog(row)));
  } catch (error) {
    console.error('Erro em /dashboard/auditoria. Usando arquivo:', error?.message || error);
    const users = readUsuarios();
    const usersById = new Map(users.map((user) => [Number(user.id), user]));
    const rows = readLogsAuditoria()
      .filter((row) => (!entidade || String(row.entidade || '') === entidade) && (!entidadeId || Number(row.entidadeId || 0) === entidadeId))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, limit)
      .map((row) => normalizeAuditLog(row, usersById));
    return res.json(rows);
  }
});

export default router;
