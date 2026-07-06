import { Router } from "express";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { docaPainel } from "../utils/operations.js";
import { fetchAgendamentosRaw, fetchDocaPainelRaw } from "../utils/db-fallback.js";
import { readAgendamentos, readDocumentos, buildDocaPainelFromFiles } from "../utils/file-store.js";
import { withComputedTotals } from "../utils/agendamento-helpers.js";
import { enrichAgendamentoWithMonitoring, sendMonthlyNearDueDigestIfNeeded } from "../utils/nf-monitoring.js";

const router = Router();
router.use(authRequired);

// Cache em memória para o dashboard operacional (TTL: 30s por data)
const _dashCache = new Map();
const DASH_CACHE_TTL = 30_000;
function getDashCache(key) {
  const entry = _dashCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > DASH_CACHE_TTL) { _dashCache.delete(key); return null; }
  return entry.data;
}
function setDashCache(key, data) {
  _dashCache.set(key, { ts: Date.now(), data });
}

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

router.get("/operacional", requirePermission("dashboard.view"), async (req, res) => {
  const q = req.query || {};
  // String vazia ou ausente = sem filtro de data (exibe todos)
  const dataAgendada = (q.dataAgendada && String(q.dataAgendada).trim()) ? String(q.dataAgendada).trim() : null;

  // Cache: só aplica quando não há filtros extras (status, fornecedor, etc.)
  const hasExtraFilters = q.status || q.fornecedor || q.transportadora || q.motorista || q.placa;
  const cacheKey = `operacional:${dataAgendada || 'all'}`;
  if (!hasExtraFilters) {
    const cached = getDashCache(cacheKey);
    if (cached) return res.json(cached);
  }

  const where = {
    ...(q.status ? { status: String(q.status) } : {}),
    ...(q.fornecedor ? { fornecedor: { contains: String(q.fornecedor) } } : {}),
    ...(q.transportadora ? { transportadora: { contains: String(q.transportadora) } } : {}),
    ...(q.motorista ? { motorista: { contains: String(q.motorista) } } : {}),
    ...(q.placa ? { placa: { contains: String(q.placa) } } : {}),
    ...(dataAgendada ? { dataAgendada } : {})
  };

  try {
    const [agendamentos, kpiRows] = await Promise.all([
      prisma.agendamento.findMany({ where, include: { notasFiscais: true, doca: true }, orderBy: { id: "desc" }, take: 500 }),
      prisma.$queryRawUnsafe(
        'SELECT status, COUNT(*) AS cnt, SUM(quantidadeVolumes) AS volumes, SUM(pesoTotalKg) AS pesoKg FROM Agendamento GROUP BY status'
      ).catch(() => [])
    ]);
    const painelDocas = await docaPainel(q.dataAgendada || null, agendamentos);
    const enriched = agendamentos.map(withComputedTotals);
    const byStatus = (s) => Number(kpiRows.find((r) => r.status === s)?.cnt || 0);
    const kpis = {
      total: kpiRows.reduce((a, b) => a + Number(b.cnt || 0), 0),
      pendentes: byStatus('PENDENTE_APROVACAO'),
      aprovados: byStatus('APROVADO'),
      chegou: byStatus('CHEGOU'),
      emDescarga: byStatus('EM_DESCARGA'),
      finalizados: byStatus('FINALIZADO'),
      cancelados: byStatus('CANCELADO'),
      noShow: byStatus('NO_SHOW'),
      volumes: kpiRows.reduce((a, b) => a + Number(b.volumes || 0), 0),
      pesoKg: Number(kpiRows.reduce((a, b) => a + Number(b.pesoKg || 0), 0).toFixed(3)),
      origem: "database"
    };
    sendMonthlyNearDueDigestIfNeeded({ triggeredBy: req.user?.nome || req.user?.sub || 'dashboard' }).catch(() => {});
    const payload = { kpis, agendamentos: enriched, painelDocas };
    if (!hasExtraFilters) setDashCache(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    console.error("Erro em /dashboard/operacional. Tentando fallback SQL/arquivo:", error?.message || error);
    try {
      const [agendamentos, painelDocas] = await Promise.all([fetchAgendamentosRaw(q), fetchDocaPainelRaw(q.dataAgendada || null)]);
      sendMonthlyNearDueDigestIfNeeded({ triggeredBy: req.user?.nome || req.user?.sub || 'dashboard' }).catch(() => {});
      return res.json({
        kpis: buildKpis(agendamentos, 0, "database-raw"),
        agendamentos: await Promise.all(agendamentos.map((item) => enrichAgendamentoWithMonitoring(withComputedTotals(item)))),
        painelDocas
      });
    } catch (rawError) {
      console.error("Erro no fallback SQL de /dashboard/operacional. Usando arquivo:", rawError?.message || rawError);
      const all = readAgendamentos();
      sendMonthlyNearDueDigestIfNeeded({ triggeredBy: req.user?.nome || req.user?.sub || 'dashboard' }).catch(() => {});
      return res.json({ kpis: buildKpis(all, readDocumentos().length, "arquivo"), agendamentos: await Promise.all(filterItems(all, q).map((item) => enrichAgendamentoWithMonitoring(item))), painelDocas: buildDocaPainelFromFiles(q.dataAgendada || null) });
    }
  }
});

router.get("/docas", requirePermission("docas.view"), async (req, res) => {
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

// ── Métricas para o novo dashboard ────────────────────────────────────────
router.get("/metricas", requirePermission("dashboard.view"), async (req, res) => {
  try {
    const all = await (async () => {
      try {
        return await prisma.agendamento.findMany({
          include: { notasFiscais: true, doca: true },
          orderBy: { id: "desc" },
          take: 2000
        });
      }
      catch { return readAgendamentos(); }
    })();

    // Peso recebido por dia (apenas FINALIZADO)
    const pesoMap = {};
    for (const ag of all) {
      if (String(ag.status || '').toUpperCase() !== 'FINALIZADO') continue;
      const d = String(ag.dataAgendada || '').slice(0, 10);
      if (!d) continue;
      const peso = Number(ag.pesoTotalKg || ag.quantidadePeso || 0);
      pesoMap[d] = (pesoMap[d] || 0) + peso;
    }
    const pesoPorDia = Object.entries(pesoMap).sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([data, peso]) => ({ data, peso }));

    // Ranking transportadoras: cancelamentos + no-show + atrasos
    const transpStats = {};
    for (const ag of all) {
      const transp = String(ag.transportadora || 'Desconhecida').trim();
      if (!transp) continue;
      if (!transpStats[transp]) transpStats[transp] = { nome: transp, cancelamentos: 0, noShow: 0, atrasos: 0, finalizados: 0 };
      const s = String(ag.status || '').toUpperCase();
      if (s === 'CANCELADO') transpStats[transp].cancelamentos++;
      if (s === 'NO_SHOW') transpStats[transp].noShow++;
      if (s === 'FINALIZADO') {
        transpStats[transp].finalizados++;
        // atraso: checkin depois da horaAgendada
        if (ag.horaAgendada && ag.dataAgendada && ag.checkinEm) {
          const scheduled = new Date(`${ag.dataAgendada}T${ag.horaAgendada}`);
          const chegada = new Date(ag.checkinEm);
          if (!isNaN(scheduled) && !isNaN(chegada) && chegada > scheduled) transpStats[transp].atrasos++;
        }
      }
    }
    const avg = (arr) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
    const rankingOcorrencias = Object.values(transpStats)
      .map((t) => ({ ...t, ocorrencias: t.cancelamentos + t.noShow + t.atrasos }))
      .filter((t) => t.cancelamentos + t.noShow + t.finalizados + t.atrasos > 0)
      .sort((a, b) => b.ocorrencias - a.ocorrencias);

    const rankingMelhores = [...rankingOcorrencias]
      .filter((t) => t.finalizados > 0)
      .map((t) => ({ ...t, pontos: t.finalizados - t.ocorrencias }))
      .sort((a, b) => b.pontos - a.pontos || b.finalizados - a.finalizados);

    // Média de tempo de recebimento geral (chegou → finalizado)
    const temposRecebimento = all.filter((ag) => ag.checkinEm && ag.fimDescargaEm).map((ag) => {
      return (new Date(ag.fimDescargaEm) - new Date(ag.checkinEm)) / 60000;
    }).filter((v) => v > 0 && v < 600);
    const mediaRecebimentoMin = avg(temposRecebimento);

    res.json({ pesoPorDia, rankingOcorrencias: rankingOcorrencias.slice(0, 10), rankingMelhores: rankingMelhores.slice(0, 10), mediaRecebimentoMin });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/logs", requirePermission("logs.view"), async (req, res) => {
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
