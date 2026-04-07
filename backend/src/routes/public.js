import express from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken, verifyInternalSession } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from "../utils/db-fallback.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { calculateTotals, normalizeCpf } from "../utils/agendamento-helpers.js";
import {
  readJanelas,
  readDocas,
  readAgendamentos,
  readFornecedoresPendentes,
  createAgendamentoFile,
  findAgendamentoByTokenFile,
  updateAgendamentoFile,
  readRegras
} from "../utils/file-store.js";
import { ensureLatestRelatorioImport, listFornecedoresPendentesImportados, getRelatorioImportStatus, getRelatorioRowsCount } from "../utils/relatorio-entradas.js";
import { auditLog } from "../utils/audit.js";
import { getFeedbackRequestByToken, submitFeedbackByToken, maskCpf } from "../utils/driver-feedback.js";
import { sendDriverFeedbackRequestEmail } from "../utils/feedback-notifications.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];
const MANUAL_AUTH_PROFILES = ["ADMIN", "OPERADOR", "GESTOR", "PORTARIA"];

function validateNfBatch(notas = []) {
  for (const nota of notas) validateNf(nota || {});
}

function parseJanelaCodigo(codigo = "") {
  const m = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  return m ? { horaInicio: m[1], horaFim: m[2] || "", codigo: String(codigo) } : { horaInicio: String(codigo).trim() || "00:00", horaFim: "", codigo: String(codigo) };
}

function formatDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function getBaseUrl(req) {
  return process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : `${req.protocol}://${req.get("host")}`;
}

function buildLinks(req, item) {
  const base = getBaseUrl(req);
  return {
    consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`,
    motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`,
    voucher: `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`,
    checkin: `${base}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`,
    checkout: `${base}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkoutToken || "")}`
  };
}

function formatItem(item, req) {
  const links = buildLinks(req, item);
  return {
    ...item,
    semaforo: trafficColor(item.status),
    links,
    doca: item.doca?.codigo || item.doca || "A DEFINIR",
    janela: item.janela?.codigo || item.janela || "-"
  };
}

function canDriverCancel(item) {
  if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW", "EM_DESCARGA"].includes(item.status)) {
    return { allowed: false, reason: "Status não permite cancelamento." };
  }
  const schedule = new Date(`${item.dataAgendada}T${item.horaAgendada}:00`);
  const diffHours = (schedule.getTime() - Date.now()) / 36e5;
  return !Number.isFinite(diffHours) || diffHours < 24
    ? { allowed: false, reason: "Cancelamento permitido apenas com 24h de antecedência." }
    : { allowed: true, reason: "Cancelamento disponível." };
}

function getOptionalActor(req) {
  try {
    const header = String(req.headers.authorization || "");
    if (!header.startsWith("Bearer ")) return null;
    return verifyInternalSession(header.slice(7));
  } catch {
    return null;
  }
}

function canManuallyAuthorize(actor) {
  return !!actor && MANUAL_AUTH_PROFILES.includes(String(actor.perfil || ""));
}

function getToleranceMinutes() {
  const regra = readRegras()[0] || {};
  const tol = Number(regra.toleranciaAtrasoMin ?? 15);
  return Number.isFinite(tol) && tol >= 0 ? tol : 15;
}

function buildCheckinWindow(item) {
  const data = String(item?.dataAgendada || "").trim();
  const hora = String(item?.horaAgendada || "").trim();
  if (!data || !hora) return { scheduledAt: null, diffMinutes: null, toleranceMinutes: getToleranceMinutes(), dateMismatch: false, timeMismatch: false };
  const scheduledAt = formatDateTime(`${data}T${hora}:00`);
  if (!scheduledAt) return { scheduledAt: null, diffMinutes: null, toleranceMinutes: getToleranceMinutes(), dateMismatch: false, timeMismatch: false };
  const now = new Date();
  const toleranceMinutes = getToleranceMinutes();
  const diffMinutes = Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
  const dateMismatch = formatDate(now) !== data;
  const timeMismatch = Math.abs(diffMinutes) > toleranceMinutes;
  return { scheduledAt, diffMinutes, toleranceMinutes, dateMismatch, timeMismatch };
}

function buildCheckinMismatchMessage(item, windowInfo) {
  const parts = [];
  if (windowInfo?.dateMismatch) {
    parts.push(`data divergente (agendado para ${item.dataAgendada}, hoje ${formatDate(new Date())})`);
  }
  if (windowInfo?.timeMismatch) {
    const diff = Number(windowInfo?.diffMinutes || 0);
    const descriptor = diff >= 0 ? `${diff} min de atraso` : `${Math.abs(diff)} min de antecedência`;
    parts.push(`fora do horário (${descriptor}; tolerância ${windowInfo.toleranceMinutes} min)`);
  }
  return `Check-in fora da janela operacional: ${parts.join(' e ')}. Somente um operador autorizado pode liberar manualmente.`;
}

async function getOrCreateDocaPadrao() {
  try {
    const existing = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } });
    if (existing) return existing;
    const first = await prisma.doca.findFirst({ orderBy: { id: "asc" } });
    if (first) return first;
    return prisma.doca.create({ data: { codigo: "A DEFINIR", descricao: "Doca definida pelo operador do recebimento" } });
  } catch {
    const docas = readDocas();
    return docas.find((d) => d.codigo === "A DEFINIR") || docas[0] || { id: 1, codigo: "A DEFINIR", descricao: "Doca definida pelo operador do recebimento" };
  }
}

async function resolveByToken(token) {
  try {
    return await prisma.agendamento.findFirst({
      where: { OR: [{ publicTokenFornecedor: token }, { publicTokenMotorista: token }, { checkinToken: token }, { checkoutToken: token }] },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
  } catch {
    return findAgendamentoByTokenFile(token);
  }
}

async function logPublicAction({ actor = null, action, item, req, details = null }) {
  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    perfil: actor?.perfil || null,
    acao: action,
    entidade: "AGENDAMENTO",
    entidadeId: Number(item?.id || 0) || null,
    detalhes,
    ip: req.ip
  });
}

router.get("/disponibilidade", async (req, res) => {
  const dias = Math.max(1, Math.min(31, Number(req.query?.dias || 14)));
  try {
    const { janelas, docas } = await fetchJanelasDocas();
    const hoje = new Date();
    const datas = Array.from({ length: dias }, (_, index) => {
      const next = new Date(hoje);
      next.setDate(hoje.getDate() + index);
      return formatDate(next);
    });
    const agenda = await Promise.all(datas.map(async (data) => {
      const ocupados = await fetchAgendamentosByDatasStatuses([data], ACTIVE_STATUSES);
      const horarios = janelas.map((janela) => {
        const parsed = parseJanelaCodigo(janela.codigo);
        const ocupadosJanela = ocupados.filter((ag) => String(ag.janelaId || ag.janela?.id || ag.janela || "") === String(janela.id) || String(ag.horaAgendada || "") === parsed.horaInicio).length;
        const capacidade = Math.max(docas.length, 1);
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || "",
          ocupados: ocupadosJanela,
          disponivel: Math.max(capacidade - ocupadosJanela, 0),
          ativo: Math.max(capacidade - ocupadosJanela, 0) > 0
        };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    }));
    return res.json({ agenda, meta: { dias, origem: "database" } });
  } catch {
    const janelas = readJanelas();
    const docas = readDocas();
    const all = readAgendamentos();
    const hoje = new Date();
    const agenda = Array.from({ length: dias }, (_, index) => {
      const next = new Date(hoje);
      next.setDate(hoje.getDate() + index);
      const data = formatDate(next);
      const horarios = janelas.map((janela) => {
        const parsed = parseJanelaCodigo(janela.codigo);
        const ocupados = all.filter((ag) => String(ag.dataAgendada) === data && ACTIVE_STATUSES.includes(ag.status) && (String(ag.janelaId || "") === String(janela.id) || String(ag.horaAgendada || "") === parsed.horaInicio)).length;
        const capacidade = Math.max(docas.length, 1);
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || "",
          ocupados,
          disponivel: Math.max(capacidade - ocupados, 0),
          ativo: Math.max(capacidade - ocupados, 0) > 0
        };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    });
    return res.json({ agenda, meta: { dias, origem: "arquivo" } });
  }
});

router.get("/relatorio-status", async (_req, res) => {
  try {
    await ensureLatestRelatorioImport({ forceIfEmpty: true });
    res.json({
      ultimoProcessamento: getRelatorioImportStatus(),
      totalLinhasNoBanco: await getRelatorioRowsCount()
    });
  } catch (error) {
    console.error("[RELATORIO_IMPORT] Falha ao consultar status:", error?.message || error);
    res.status(500).json({ message: error?.message || "Falha ao consultar o status da importação." });
  }
});

router.get("/fornecedores-pendentes", async (_req, res) => {
  try {
    await ensureLatestRelatorioImport({ forceIfEmpty: true });
    return res.json(await listFornecedoresPendentesImportados());
  } catch (error) {
    console.error("[RELATORIO_IMPORT] Falha ao montar fornecedores pendentes:", error?.message || error);
    return res.json(readFornecedoresPendentes());
  }
});

async function createPublicAgendamentoInDatabase({ agendamentoPayload, notas, cpfMotorista }) {
  const protocolo = generateProtocol();
  const publicTokenMotorista = generatePublicToken("MOT", cpfMotorista);
  const publicTokenFornecedor = generatePublicToken("FOR", agendamentoPayload.fornecedor);
  const checkinToken = generatePublicToken("CHK", cpfMotorista || agendamentoPayload.placa);
  const checkoutToken = generatePublicToken("OUT", cpfMotorista || agendamentoPayload.placa);

  const createdId = await prisma.$transaction(async (tx) => {
    const created = await tx.agendamento.create({
      data: {
        protocolo,
        publicTokenMotorista,
        publicTokenFornecedor,
        checkinToken,
        checkoutToken,
        fornecedor: agendamentoPayload.fornecedor,
        transportadora: agendamentoPayload.transportadora,
        motorista: agendamentoPayload.motorista,
        cpfMotorista: agendamentoPayload.cpfMotorista || "",
        telefoneMotorista: agendamentoPayload.telefoneMotorista || "",
        emailMotorista: agendamentoPayload.emailMotorista || "",
        emailTransportadora: agendamentoPayload.emailTransportadora || "",
        placa: agendamentoPayload.placa,
        dataAgendada: agendamentoPayload.dataAgendada,
        horaAgendada: agendamentoPayload.horaAgendada,
        janelaId: Number(agendamentoPayload.janelaId),
        docaId: Number(agendamentoPayload.docaId),
        observacoes: agendamentoPayload.observacoes || "",
        quantidadeNotas: Number(agendamentoPayload.quantidadeNotas || 0),
        quantidadeVolumes: Number(agendamentoPayload.quantidadeVolumes || 0),
        pesoTotalKg: Number(agendamentoPayload.pesoTotalKg || 0),
        valorTotalNf: Number(agendamentoPayload.valorTotalNf || 0),
        status: "PENDENTE_APROVACAO",
        lgpdConsentAt: new Date()
      }
    });

    if (notas.length) {
      await tx.notaFiscal.createMany({
        data: notas.map((nota) => ({
          agendamentoId: created.id,
          numeroNf: String(nota?.numeroNf || "").trim(),
          serie: String(nota?.serie || "").trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || "").trim()
        }))
      });
    }

    return created.id;
  });

  return prisma.agendamento.findUnique({ where: { id: createdId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
}

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const janelaId = Number(payload.janelaId);
    if (!janelaId) return res.status(400).json({ message: "Janela é obrigatória." });
    const cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || "");
    const notas = Array.isArray(payload.notas)
      ? payload.notas.map((nota) => ({
          numeroNf: String(nota?.numeroNf || "").trim(),
          serie: String(nota?.serie || "").trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || "").trim()
        }))
      : [];
    validateNfBatch(notas);
    const totals = calculateTotals(notas, payload);
    const doca = await getOrCreateDocaPadrao();
    let janela;
    try {
      janela = await prisma.janela.findUnique({ where: { id: janelaId } });
    } catch {}
    janela ||= readJanelas().find((item) => Number(item.id) === janelaId);
    if (!janela) return res.status(404).json({ message: "Janela não encontrada." });
    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const agendamentoPayload = {
      fornecedor: String(payload.fornecedor || "").trim(),
      transportadora: String(payload.transportadora || "").trim(),
      motorista: String(payload.motorista || "").trim(),
      cpfMotorista,
      telefoneMotorista: String(payload.telefoneMotorista || "").trim(),
      emailMotorista: String(payload.emailMotorista || "").trim(),
      emailTransportadora: String(payload.emailTransportadora || "").trim(),
      placa: String(payload.placa || "").trim().toUpperCase(),
      dataAgendada: String(payload.dataAgendada || "").trim(),
      horaAgendada,
      janelaId,
      docaId: doca.id,
      observacoes: String(payload.observacoes || "").trim(),
      lgpdConsent: Boolean(payload.lgpdConsent),
      ...totals
    };
    validateAgendamentoPayload(agendamentoPayload, true);

    try {
      await assertJanelaDocaDisponivel({ docaId: doca.id, janelaId, dataAgendada: agendamentoPayload.dataAgendada });
      const full = await createPublicAgendamentoInDatabase({ agendamentoPayload, notas, cpfMotorista });
      const links = buildLinks(req, full);
      return res.status(201).json({
        ok: true,
        id: full.id,
        protocolo: full.protocolo,
        horaAgendada,
        doca: full.doca?.codigo || "A DEFINIR",
        linkMotorista: links.motorista,
        linkFornecedor: links.consulta,
        voucher: links.voucher,
        tokenMotorista: full.publicTokenMotorista,
        tokenConsulta: full.publicTokenFornecedor,
        tokenCheckout: full.checkoutToken
      });
    } catch {
      const record = createAgendamentoFile({
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken("MOT", cpfMotorista),
        publicTokenFornecedor: generatePublicToken("FOR", agendamentoPayload.fornecedor),
        checkinToken: generatePublicToken("CHK", cpfMotorista || agendamentoPayload.placa),
        checkoutToken: generatePublicToken("OUT", cpfMotorista || agendamentoPayload.placa),
        ...agendamentoPayload,
        status: "PENDENTE_APROVACAO",
        lgpdConsentAt: new Date().toISOString(),
        notasFiscais: notas,
        doca: doca.codigo || "A DEFINIR",
        janela: janela.codigo
      });
      const links = buildLinks(req, record);
      return res.status(201).json({
        ok: true,
        id: record.id,
        protocolo: record.protocolo,
        horaAgendada,
        doca: record.doca || "A DEFINIR",
        linkMotorista: links.motorista,
        linkFornecedor: links.consulta,
        voucher: links.voucher,
        tokenMotorista: record.publicTokenMotorista,
        tokenConsulta: record.publicTokenFornecedor,
        tokenCheckout: record.checkoutToken,
        origem: "arquivo"
      });
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/motorista/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json({ ...formatItem(item, req), cancelamento: canDriverCancel(item) });
});

router.post("/motorista/:token/cancelar", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  const rule = canDriverCancel(item);
  if (!rule.allowed) return res.status(400).json({ message: rule.reason });
  try {
    const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: "CANCELADO", motivoCancelamento: String(req.body?.motivo || "Cancelado pelo motorista").trim() } });
    await logPublicAction({ action: "CANCELAMENTO_MOTORISTA", item: updated, req, details: { motivo: req.body?.motivo || "Cancelado pelo motorista" } });
    return res.json({ ok: true, message: "Agendamento cancelado com sucesso.", agendamento: updated });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: "CANCELADO", motivoCancelamento: String(req.body?.motivo || "Cancelado pelo motorista").trim() });
    await logPublicAction({ action: "CANCELAMENTO_MOTORISTA", item: updated, req, details: { motivo: req.body?.motivo || "Cancelado pelo motorista" } });
    return res.json({ ok: true, message: "Agendamento cancelado com sucesso.", agendamento: updated });
  }
});

router.get("/consulta/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json(formatItem(item, req));
});

router.get("/fornecedor/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json(formatItem(item, req));
});

router.get("/voucher/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=voucher-${item.protocolo}.pdf`);
  res.send(pdf);
});

router.get("/avaliacao/:token", async (req, res) => {
  const record = await getFeedbackRequestByToken(req.params.token);
  if (!record) return res.status(404).json({ message: "Token de avaliação inválido." });
  return res.json({
    token: record.token,
    protocolo: record.protocolo,
    fornecedor: record.fornecedor,
    transportadora: record.transportadora,
    motorista: record.motorista,
    cpfMotorista: maskCpf(record.cpfMotorista),
    placa: record.placa,
    dataAgendada: record.dataAgendada,
    horaAgendada: record.horaAgendada,
    respondeu: !!record.respondeu,
    respondeuEm: record.respondeuEm
  });
});

router.post("/avaliacao/:token", async (req, res) => {
  const result = await submitFeedbackByToken(req.params.token, req.body || {});
  if (!result.ok && result.reason === "not_found") return res.status(404).json({ message: "Token de avaliação inválido." });
  if (!result.ok && result.reason === "already_submitted") return res.status(409).json({ message: "Esta avaliação já foi respondida.", record: result.record });
  await auditLog({
    usuarioId: null,
    perfil: "MOTORISTA",
    acao: "RESPONDER_AVALIACAO",
    entidade: "AGENDAMENTO",
    entidadeId: Number(result.record?.agendamentoId || 0) || null,
    detalhes: {
      token: req.params.token,
      respondeuEm: result.record?.respondeuEm || null
    },
    ip: req.ip
  });
  return res.json({ ok: true, message: "Avaliação registrada com sucesso.", record: result.record });
});

router.post("/checkin/:token", async (req, res) => {
  const actor = getOptionalActor(req);
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });
  if (!["APROVADO", "CHEGOU"].includes(item.status)) return res.status(400).json({ message: "Check-in só permitido para agendamentos aprovados." });

  const windowInfo = buildCheckinWindow(item);
  const requiresManualAuthorization = !!(windowInfo.dateMismatch || windowInfo.timeMismatch);
  const overrideRequested = !!(req.body?.overrideDateMismatch || req.body?.overrideTimeMismatch || req.body?.overrideManualAuthorization);

  if (requiresManualAuthorization && !overrideRequested) {
    return res.status(409).json({
      message: buildCheckinMismatchMessage(item, windowInfo),
      requiresManualAuthorization: true,
      dateMismatch: windowInfo.dateMismatch,
      timeMismatch: windowInfo.timeMismatch,
      toleranceMinutes: windowInfo.toleranceMinutes,
      diffMinutes: windowInfo.diffMinutes
    });
  }

  if (requiresManualAuthorization && overrideRequested && !canManuallyAuthorize(actor)) {
    return res.status(403).json({ message: "A liberação manual do check-in fora da janela só pode ser feita por operador, portaria, gestor ou administrador autenticado." });
  }

  const patch = { status: "CHEGOU", checkinEm: item.checkinEm || new Date() };
  let updated;
  try {
    updated = await prisma.agendamento.update({ where: { id: item.id }, data: patch });
  } catch {
    updated = updateAgendamentoFile(item.id, { ...patch, checkinEm: item.checkinEm || new Date().toISOString() });
  }

  const action = requiresManualAuthorization ? "AUTORIZAR_CHECKIN_FORA_JANELA" : "CHECKIN_QR";
  await logPublicAction({
    actor,
    action,
    item: updated,
    req,
    details: {
      origem: "qr-code",
      dateMismatch: windowInfo.dateMismatch,
      timeMismatch: windowInfo.timeMismatch,
      toleranceMinutes: windowInfo.toleranceMinutes,
      diffMinutes: windowInfo.diffMinutes
    }
  });

  return res.json({
    ok: true,
    message: requiresManualAuthorization ? "Check-in realizado com liberação manual do operador." : "Check-in realizado com sucesso.",
    agendamento: updated,
    requiresManualAuthorization: false
  });
});

router.post("/checkout/:token", async (req, res) => {
  const actor = getOptionalActor(req);
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token de check-out inválido." });
  if (!["CHEGOU", "EM_DESCARGA"].includes(item.status)) return res.status(400).json({ message: "Check-out só permitido após a chegada." });

  let updated;
  try {
    updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: "FINALIZADO", fimDescargaEm: new Date() } });
  } catch {
    updated = updateAgendamentoFile(item.id, { status: "FINALIZADO", fimDescargaEm: new Date().toISOString() });
  }

  const survey = await sendDriverFeedbackRequestEmail({
    agendamento: { ...item, ...updated },
    baseUrl: getBaseUrl(req)
  });

  await logPublicAction({
    actor,
    action: "CHECKOUT_QR",
    item: updated,
    req,
    details: {
      origem: "qr-code",
      surveySent: !!survey?.sent,
      surveyTo: survey?.to || null,
      feedbackLink: survey?.feedbackLink || null,
      surveyReason: survey?.reason || null
    }
  });

  return res.json({ ok: true, message: "Check-out realizado com sucesso.", agendamento: updated, avaliacao: survey });
});

export default router;
