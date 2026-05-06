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
    sendMonthlyNearDueDigestIfNeeded({ triggeredBy: req.user?.nome || req.user?.sub || 'dashboard' }).catch(() => {});
    return res.json({ kpis: buildKpis(all, docs, "database"), agendamentos: await Promise.all(agendamentos.map((item) => enrichAgendamentoWithMonitoring(withComputedTotals(item)))), painelDocas });
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
      try { return await prisma.agendamento.findMany({ include: { notasFiscais: true, doca: true } }); }
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
      if (!transpStats[transp]) transpStats[transp] = { nome: transp, cancelamentos: 0, noShow: 0, atrasos: 0, finalizados: 0, tempoDescargaMin: [], tempoAgendaChegadaMin: [] };
      const s = String(ag.status || '').toUpperCase();
      if (s === 'CANCELADO') transpStats[transp].cancelamentos++;
      if (s === 'NO_SHOW') transpStats[transp].noShow++;
      if (s === 'FINALIZADO') {
        transpStats[transp].finalizados++;
        if (ag.checkinEm && ag.inicioDescargaEm) {
          const chegada = new Date(ag.checkinEm);
          const inicio = new Date(ag.inicioDescargaEm);
          const fim = ag.fimDescargaEm ? new Date(ag.fimDescargaEm) : null;
          if (fim && !isNaN(fim) && !isNaN(inicio)) transpStats[transp].tempoDescargaMin.push((fim - inicio) / 60000);
        }
        if (ag.criadoEm && ag.checkinEm) {
          const criado = new Date(ag.criadoEm || ag.createdAt);
          const chegada = new Date(ag.checkinEm);
          if (!isNaN(criado) && !isNaN(chegada)) transpStats[transp].tempoAgendaChegadaMin.push((chegada - criado) / 60000);
        }
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
      .map((t) => ({ ...t, ocorrencias: t.cancelamentos + t.noShow + t.atrasos, mediaDescargaMin: avg(t.tempoDescargaMin), mediaAgendaChegadaMin: avg(t.tempoAgendaChegadaMin) }))
      .filter((t) => t.cancelamentos + t.noShow + t.finalizados + t.atrasos > 0)
      .sort((a, b) => b.ocorrencias - a.ocorrencias);

    const rankingMelhores = [...rankingOcorrencias]
      .filter((t) => t.finalizados > 0)
      .sort((a, b) => (a.ocorrencias / Math.max(a.finalizados, 1)) - (b.ocorrencias / Math.max(b.finalizados, 1)));

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
