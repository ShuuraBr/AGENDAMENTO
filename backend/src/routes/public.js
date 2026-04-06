import express from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from "../utils/db-fallback.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { calculateTotals, normalizeCpf } from "../utils/agendamento-helpers.js";
import { getOptionalUserFromRequest } from "../middlewares/auth.js";
import { auditLog } from "../utils/audit.js";
import { sendMail } from "../utils/email.js";
import {
  readJanelas,
  readDocas,
  readAgendamentos,
  readFornecedoresPendentes,
  createAgendamentoFile,
  findAgendamentoByTokenFile,
  findAgendamentoFile,
  updateAgendamentoFile,
  readRegras,
  findAvaliacaoAtendimentoByToken,
  upsertAvaliacaoAtendimentoFile
} from "../utils/file-store.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];
const INTERNAL_AUTH_OVERRIDE_PROFILES = ["ADMIN", "OPERADOR", "GESTOR", "PORTARIA"];

function validateNfBatch(notas = []) {
  for (const nota of notas) validateNf(nota || {});
}

function parseJanelaCodigo(codigo = "") {
  const match = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  return match
    ? { horaInicio: match[1], horaFim: match[2] || "", codigo: String(codigo) }
    : { horaInicio: String(codigo).trim() || "00:00", horaFim: "", codigo: String(codigo) };
}

function formatDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateBR(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  return year && month && day ? `${day}/${month}/${year}` : String(value);
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

async function getOrCreateDocaPadrao() {
  try {
    const existing = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } });
    if (existing) return existing;
    const first = await prisma.doca.findFirst({ orderBy: { id: "asc" } });
    if (first) return first;
    return prisma.doca.create({ data: { codigo: "A DEFINIR", descricao: "Doca definida pelo operador do recebimento" } });
  } catch {
    const docas = readDocas();
    return docas.find((doca) => doca.codigo === "A DEFINIR") || docas[0] || { id: 1, codigo: "A DEFINIR", descricao: "Doca definida pelo operador do recebimento" };
  }
}

async function resolveByToken(token) {
  try {
    return await prisma.agendamento.findFirst({
      where: {
        OR: [
          { publicTokenFornecedor: token },
          { publicTokenMotorista: token },
          { checkinToken: token },
          { checkoutToken: token }
        ]
      },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
  } catch {
    return findAgendamentoByTokenFile(token);
  }
}

async function getToleranciaAtrasoMin() {
  try {
    const regra = await prisma.regra.findFirst({ orderBy: { id: "asc" } });
    if (regra?.toleranciaAtrasoMin != null) return Number(regra.toleranciaAtrasoMin) || 15;
  } catch {}
  return Number(readRegras()?.[0]?.toleranciaAtrasoMin || 15) || 15;
}

async function evaluateCheckinWindow(item) {
  const now = new Date();
  const currentDate = formatDate(now);
  const reasons = [];
  if (String(item?.dataAgendada || "") !== currentDate) {
    reasons.push(`Data divergente. Agendamento: ${item.dataAgendada}. Hoje: ${currentDate}.`);
  }

  const tolerancia = await getToleranciaAtrasoMin();
  const scheduledAt = new Date(`${item.dataAgendada}T${item.horaAgendada}:00`);
  if (!Number.isNaN(scheduledAt.getTime())) {
    const diffMinutes = Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
    if (Math.abs(diffMinutes) > tolerancia) {
      if (diffMinutes > 0) {
        reasons.push(`Horário divergente. O veículo está ${diffMinutes} minuto(s) após o horário agendado (${item.horaAgendada}). Tolerância configurada: ${tolerancia} minuto(s).`);
      } else {
        reasons.push(`Horário divergente. O veículo está ${Math.abs(diffMinutes)} minuto(s) antes do horário agendado (${item.horaAgendada}). Tolerância configurada: ${tolerancia} minuto(s).`);
      }
    }
  }

  return {
    manualRequired: reasons.length > 0,
    reasons,
    toleranciaAtrasoMin: tolerancia
  };
}

function ensureInternalOverrideUser(req) {
  const user = getOptionalUserFromRequest(req);
  if (!user || !INTERNAL_AUTH_OVERRIDE_PROFILES.includes(String(user.perfil || ""))) {
    throw Object.assign(new Error("A liberação manual exige autenticação de um operador autorizado."), { statusCode: 403 });
  }
  return user;
}

async function findAvaliacaoAtendimento(token) {
  try {
    return await prisma.avaliacaoAtendimento.findUnique({ where: { token } });
  } catch {
    return findAvaliacaoAtendimentoByToken(token);
  }
}

async function saveAvaliacaoAtendimento(payload) {
  try {
    const existing = await prisma.avaliacaoAtendimento.findFirst({ where: { agendamentoId: Number(payload.agendamentoId) } });
    if (existing) {
      return await prisma.avaliacaoAtendimento.update({ where: { id: existing.id }, data: payload });
    }
    return await prisma.avaliacaoAtendimento.create({ data: payload });
  } catch {
    return upsertAvaliacaoAtendimentoFile(payload);
  }
}

async function sendCheckoutSurveyEmail(item, req, actor = null) {
  if (!item?.emailMotorista) {
    return { sent: false, reason: "Sem e-mail do motorista cadastrado." };
  }

  const token = generatePublicToken("AVL", item.protocolo || item.cpfMotorista || item.placa);
  const surveyUrl = `${getBaseUrl(req)}/?view=avaliacao&token=${encodeURIComponent(token)}`;
  const record = await saveAvaliacaoAtendimento({
    agendamentoId: Number(item.id),
    protocolo: item.protocolo,
    token,
    emailMotorista: item.emailMotorista,
    enviadoEm: new Date(),
    respondidoEm: null,
    notaAtendimento: null,
    notaEquipeRecebimento: null,
    processoTranquilo: null,
    processoRapido: null,
    comentario: null
  });

  const sent = await sendMail({
    to: item.emailMotorista,
    subject: `Avaliação do atendimento - ${item.protocolo}`,
    text: `Olá.\n\nSeu check-out do agendamento ${item.protocolo} foi concluído.\n\nGostaríamos de receber sua avaliação sobre o atendimento da equipe de recebimento e sobre a eficiência do processo de descarga.\n\nResponda pelo link: ${surveyUrl}`,
    html: `<p>Olá.</p><p>Seu check-out do agendamento <strong>${item.protocolo}</strong> foi concluído.</p><p>Gostaríamos de receber sua avaliação sobre o atendimento da equipe de recebimento e sobre a eficiência do processo de descarga.</p><p><a href="${surveyUrl}">Responder avaliação</a></p>`
  });

  await auditLog({
    usuarioId: actor?.sub || null,
    perfil: actor?.perfil || "SISTEMA",
    acao: "ENVIAR_PESQUISA_ATENDIMENTO",
    entidade: "AGENDAMENTO",
    entidadeId: item.id,
    detalhes: { avaliacaoId: record?.id || null, enviadoPara: item.emailMotorista, sent: !!sent?.sent },
    ip: req.ip
  });

  return { ...sent, surveyUrl };
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

router.get("/fornecedores-pendentes", async (_req, res) => {
  res.json(readFornecedoresPendentes());
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
      await auditLog({
        usuarioId: null,
        perfil: "PUBLICO",
        acao: "CRIAR_SOLICITACAO_PUBLICA",
        entidade: "AGENDAMENTO",
        entidadeId: full.id,
        detalhes: { fornecedor: full.fornecedor, transportadora: full.transportadora, motorista: full.motorista, origem: "portal-publico" },
        ip: req.ip
      });
      return res.status(201).json({ ok: true, id: full.id, protocolo: full.protocolo, horaAgendada, doca: full.doca?.codigo || "A DEFINIR", linkMotorista: links.motorista, linkFornecedor: links.consulta, voucher: links.voucher, tokenMotorista: full.publicTokenMotorista, tokenConsulta: full.publicTokenFornecedor, tokenCheckout: full.checkoutToken });
    } catch (dbErr) {
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
      await auditLog({
        usuarioId: null,
        perfil: "PUBLICO",
        acao: "CRIAR_SOLICITACAO_PUBLICA",
        entidade: "AGENDAMENTO",
        entidadeId: record.id,
        detalhes: { fornecedor: record.fornecedor, transportadora: record.transportadora, motorista: record.motorista, origem: "arquivo" },
        ip: req.ip
      });
      return res.status(201).json({ ok: true, id: record.id, protocolo: record.protocolo, horaAgendada, doca: record.doca || "A DEFINIR", linkMotorista: links.motorista, linkFornecedor: links.consulta, voucher: links.voucher, tokenMotorista: record.publicTokenMotorista, tokenConsulta: record.publicTokenFornecedor, tokenCheckout: record.checkoutToken, origem: "arquivo" });
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
    await auditLog({ usuarioId: null, perfil: "MOTORISTA", acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { via: "portal-motorista" }, ip: req.ip });
    return res.json({ ok: true, message: "Agendamento cancelado com sucesso.", agendamento: updated });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: "CANCELADO", motivoCancelamento: String(req.body?.motivo || "Cancelado pelo motorista").trim() });
    await auditLog({ usuarioId: null, perfil: "MOTORISTA", acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { via: "portal-motorista" }, ip: req.ip });
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

router.post("/checkin/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });
  if (!["APROVADO", "CHEGOU"].includes(item.status)) {
    return res.status(400).json({ message: "Check-in só permitido para agendamentos aprovados." });
  }

  const scheduleCheck = await evaluateCheckinWindow(item);
  const manualOverride = Boolean(req.body?.overrideScheduleMismatch);
  let actor = getOptionalUserFromRequest(req);

  if (scheduleCheck.manualRequired && !manualOverride) {
    return res.status(409).json({ message: `${scheduleCheck.reasons.join(" ")} Avalie a situação e confirme manualmente para liberar a descarga.` });
  }

  if (scheduleCheck.manualRequired && manualOverride) {
    try {
      actor = ensureInternalOverrideUser(req);
    } catch (error) {
      return res.status(error.statusCode || 403).json({ message: error.message });
    }
  }

  try {
    const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: "CHEGOU", checkinEm: item.checkinEm || new Date() } });
    await auditLog({
      usuarioId: actor?.sub || null,
      perfil: actor?.perfil || "PORTARIA",
      acao: "CHECKIN_QR",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { via: "QR_CODE", manualOverride, reasons: scheduleCheck.reasons, token: req.params.token },
      ip: req.ip
    });
    return res.json({ ok: true, message: manualOverride ? "Check-in realizado com liberação manual do operador." : "Check-in realizado com sucesso.", agendamento: updated });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: "CHEGOU", checkinEm: item.checkinEm || new Date().toISOString() });
    await auditLog({
      usuarioId: actor?.sub || null,
      perfil: actor?.perfil || "PORTARIA",
      acao: "CHECKIN_QR",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { via: "QR_CODE", manualOverride, reasons: scheduleCheck.reasons, token: req.params.token },
      ip: req.ip
    });
    return res.json({ ok: true, message: manualOverride ? "Check-in realizado com liberação manual do operador." : "Check-in realizado com sucesso.", agendamento: updated });
  }
});

router.post("/checkout/:token", async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token de check-out inválido." });
  if (!["CHEGOU", "EM_DESCARGA"].includes(item.status)) {
    return res.status(400).json({ message: "Check-out só permitido após a chegada." });
  }

  const actor = getOptionalUserFromRequest(req);
  try {
    const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: "FINALIZADO", fimDescargaEm: new Date() } });
    const survey = await sendCheckoutSurveyEmail({ ...item, ...updated }, req, actor);
    await auditLog({
      usuarioId: actor?.sub || null,
      perfil: actor?.perfil || "PORTARIA",
      acao: "CHECKOUT_QR",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { via: "QR_CODE", pesquisaEnviada: !!survey?.sent, emailMotorista: item.emailMotorista || null },
      ip: req.ip
    });
    return res.json({ ok: true, message: survey?.sent ? "Check-out realizado com sucesso. A pesquisa de atendimento foi enviada ao motorista." : "Check-out realizado com sucesso.", agendamento: updated, pesquisa: survey });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: "FINALIZADO", fimDescargaEm: new Date().toISOString() });
    const survey = await sendCheckoutSurveyEmail({ ...item, ...updated }, req, actor);
    await auditLog({
      usuarioId: actor?.sub || null,
      perfil: actor?.perfil || "PORTARIA",
      acao: "CHECKOUT_QR",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { via: "QR_CODE", pesquisaEnviada: !!survey?.sent, emailMotorista: item.emailMotorista || null },
      ip: req.ip
    });
    return res.json({ ok: true, message: survey?.sent ? "Check-out realizado com sucesso. A pesquisa de atendimento foi enviada ao motorista." : "Check-out realizado com sucesso.", agendamento: updated, pesquisa: survey });
  }
});

router.get("/avaliacao/:token", async (req, res) => {
  const avaliacao = await findAvaliacaoAtendimento(req.params.token);
  if (!avaliacao) return res.status(404).json({ message: "Pesquisa de atendimento não encontrada." });

  let agendamento = null;
  try {
    agendamento = await prisma.agendamento.findUnique({ where: { id: Number(avaliacao.agendamentoId) } });
  } catch {}
  agendamento ||= findAgendamentoFile(avaliacao.agendamentoId) || null;
  res.json({
    token: avaliacao.token,
    protocolo: avaliacao.protocolo || agendamento?.protocolo || null,
    fornecedor: agendamento?.fornecedor || null,
    motorista: agendamento?.motorista || null,
    dataAgendada: agendamento?.dataAgendada || null,
    respondidoEm: avaliacao.respondidoEm || null,
    respondida: Boolean(avaliacao.respondidoEm)
  });
});

router.post("/avaliacao/:token", async (req, res) => {
  try {
    const avaliacao = await findAvaliacaoAtendimento(req.params.token);
    if (!avaliacao) return res.status(404).json({ message: "Pesquisa de atendimento não encontrada." });
    if (avaliacao.respondidoEm) return res.status(409).json({ message: "Esta pesquisa já foi respondida." });

    const notaAtendimento = Number(req.body?.notaAtendimento);
    const notaEquipeRecebimento = Number(req.body?.notaEquipeRecebimento);
    if (!(notaAtendimento >= 1 && notaAtendimento <= 5)) {
      return res.status(400).json({ message: "Informe uma nota de 1 a 5 para o atendimento." });
    }
    if (!(notaEquipeRecebimento >= 1 && notaEquipeRecebimento <= 5)) {
      return res.status(400).json({ message: "Informe uma nota de 1 a 5 para a equipe de recebimento." });
    }

    const payload = {
      notaAtendimento,
      notaEquipeRecebimento,
      processoTranquilo: Boolean(req.body?.processoTranquilo),
      processoRapido: Boolean(req.body?.processoRapido),
      comentario: String(req.body?.comentario || "").trim(),
      respondidoEm: new Date()
    };

    try {
      await prisma.avaliacaoAtendimento.update({ where: { id: avaliacao.id }, data: payload });
    } catch {
      upsertAvaliacaoAtendimentoFile({ ...avaliacao, ...payload, token: avaliacao.token, agendamentoId: avaliacao.agendamentoId });
    }

    await auditLog({
      usuarioId: null,
      perfil: "MOTORISTA",
      acao: "RESPONDER_AVALIACAO_ATENDIMENTO",
      entidade: "AGENDAMENTO",
      entidadeId: avaliacao.agendamentoId,
      detalhes: { avaliacaoId: avaliacao.id || null },
      ip: req.ip
    });

    return res.json({ ok: true, message: "Avaliação registrada com sucesso." });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

export default router;
