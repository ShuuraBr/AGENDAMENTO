import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
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
import { encodeNotaObservacao } from "../utils/nota-metadata.js";
import { sendMail } from "../utils/email.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];
const MANUAL_AUTH_PROFILES = ["ADMIN", "OPERADOR", "GESTOR", "PORTARIA"];
const VOUCHER_ALLOWED_STATUSES = new Set(["APROVADO", "CHEGOU", "EM_DESCARGA", "FINALIZADO"]);

const publicAvariaUploadDir = path.resolve("uploads", "avarias");
fs.mkdirSync(publicAvariaUploadDir, { recursive: true });
const publicAvariaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, publicAvariaUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
  })
});

function asyncRoute(handler) {
  return function publicAsyncRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      const status = Number(error?.statusCode || error?.status || 500);
      const message = error?.message || "Erro interno do servidor.";
      console.error(`[PUBLIC_ROUTE_ERROR] ${req.method} ${req.originalUrl}:`, error?.stack || error);
      if (res.headersSent) return next(error);
      return res.status(status >= 400 && status < 600 ? status : 500).json({ message });
    });
  };
}

async function safeAwait(task, fallback = null, label = 'operacao_publica') {
  try {
    return await task();
  } catch (error) {
    console.error(`[${label}]`, error?.stack || error);
    return typeof fallback === 'function' ? fallback(error) : fallback;
  }
}

function canShareVoucher(itemOrStatus) {
  const status = typeof itemOrStatus === "string" ? itemOrStatus : itemOrStatus?.status;
  return VOUCHER_ALLOWED_STATUSES.has(String(status || "").trim().toUpperCase());
}

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

function isCurrentDaySlotFuture(data = '', hora = '') {
  const normalizedDate = String(data || '').trim();
  const normalizedHour = String(hora || '').trim();
  if (!normalizedDate || !normalizedHour) return false;
  const now = new Date();
  const today = formatDate(now);
  if (normalizedDate !== today) return true;
  const slot = formatDateTime(`${normalizedDate}T${normalizedHour}:00`);
  return !!slot && slot.getTime() > now.getTime();
}

function getBaseUrl(req) {
  return process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : `${req.protocol}://${req.get("host")}`;
}

function parsePublicOperationReference(rawValue = "") {
  const raw = String(rawValue || "").replace(/[​-‍﻿]/g, '').trim();
  if (!raw) return { token: "", id: "" };
  const decoded = (() => {
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  let token = "";
  let id = "";
  try {
    const url = decoded.startsWith("http://") || decoded.startsWith("https://")
      ? new URL(decoded)
      : new URL(decoded, "http://localhost");
    token = String(url.searchParams.get("token") || "").trim();
    id = String(url.searchParams.get("id") || "").trim();
    if (!token) {
      const pathToken = url.pathname.match(/\/(?:checkin|checkout|consulta|fornecedor|motorista|voucher)\/([^/?#]+)/i);
      if (pathToken?.[1]) token = String(pathToken[1]).trim();
    }
  } catch {}
  if (!token) {
    const queryToken = decoded.match(/(?:^|[?&])token=([^&#]+)/i);
    if (queryToken?.[1]) {
      try { token = decodeURIComponent(queryToken[1]).trim(); } catch { token = String(queryToken[1]).trim(); }
    }
  }
  if (!id) {
    const idMatch = decoded.match(/(?:^|[?&])id=(\d+)/i);
    if (idMatch?.[1]) id = String(idMatch[1]).trim();
  }
  if (!token) {
    const match = decoded.match(/(?:CHK|OUT|FOR|MOT)-[A-Z0-9]+-[A-Z0-9]+/i);
    if (match?.[0]) token = String(match[0]).trim().toUpperCase();
  }
  token = String(token || decoded).replace(/[\s\n\r"'`]+/g, "").trim();
  return { token, id: String(id || '').replace(/\D/g, '').trim() };
}

function normalizePublicOperationToken(rawValue = "") {
  return parsePublicOperationReference(rawValue).token;
}

function parseEmailList(...values) {
  const emails = values
    .flatMap((value) => String(value || "").split(/[;,]/))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return [...new Set(emails)];
}

function uploadedAvariaFilesFromReq(req) {
  const raw = req?.files;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.imagensAvaria)) return raw.imagensAvaria;
  return [];
}

function buildAvariaAttachments(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    filename: file.originalname || path.basename(file.path || ''),
    path: file.path,
    contentType: file.mimetype || undefined
  })).filter((item) => item.path);
}

function buildNotasResumo(notas = []) {
  return (Array.isArray(notas) ? notas : []).map((nota) => `NF ${nota?.numeroNf || '-'}${nota?.serie ? ` / Série ${nota.serie}` : ''}`).filter(Boolean);
}

function renderNotasResumoHtml(notas = []) {
  const items = buildNotasResumo(notas);
  if (!items.length) return '<p><strong>NFs:</strong> -</p>';
  return `<p><strong>NFs:</strong></p><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function normalizeScheduleDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return formatDate(native);
  return raw;
}

function normalizeScheduleTimeValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
  if (match) return match[1];
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const hh = String(native.getUTCHours()).padStart(2, '0');
    const mm = String(native.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return raw;
}

function resolveScheduleValues(item = {}, fallback = {}) {
  const dataAgendada = normalizeScheduleDateValue(item?.dataAgendada || fallback?.dataAgendada || '');
  const janelaCodigo = item?.janela?.codigo || fallback?.janela?.codigo || item?.janela || fallback?.janela || '';
  const horaAgendada = normalizeScheduleTimeValue(item?.horaAgendada || fallback?.horaAgendada || parseJanelaCodigo(janelaCodigo).horaInicio || '');
  return { dataAgendada, horaAgendada };
}

function normalizeScheduleItem(item = {}, fallback = {}) {
  const resolved = resolveScheduleValues(item, fallback);
  return {
    ...fallback,
    ...item,
    dataAgendada: resolved.dataAgendada,
    horaAgendada: resolved.horaAgendada || item?.horaAgendada || fallback?.horaAgendada || ''
  };
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'sim', 's', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeCheckoutPayload(body = {}) {
  const payload = {
    comoFoiDescarga: String(body?.comoFoiDescarga || body?.descargaConcluida || 'BOA').trim().toUpperCase() || 'BOA',
    houveAvaria: parseBooleanLike(body?.houveAvaria ?? body?.teveOcorrencia),
    itemAvaria: String(body?.itemAvaria || body?.item || '').trim(),
    observacaoAvaria: String(body?.observacaoAvaria || body?.descricaoOcorrencia || '').trim(),
    quantidadeAvaria: Number(body?.quantidadeAvaria || body?.quantidade || 0) || 0,
    observacaoAssistente: String(body?.observacaoAssistente || '').trim()
  };

  if (payload.houveAvaria) {
    if (!payload.itemAvaria) throw new Error('Informe o item avariado antes de concluir o check-out.');
    if (!payload.observacaoAvaria) throw new Error('Descreva a avaria antes de concluir o check-out.');
    if (!(payload.quantidadeAvaria > 0)) throw new Error('Informe a quantidade avariada antes de concluir o check-out.');
  }

  return payload;
}

function buildCheckoutObservation(payload = {}) {
  const parts = [`Descarga: ${payload.comoFoiDescarga || 'BOA'}`];
  if (payload.houveAvaria) {
    parts.push('Avaria: SIM');
    parts.push(`Item: ${payload.itemAvaria}`);
    parts.push(`Quantidade: ${payload.quantidadeAvaria}`);
    parts.push(`Detalhe: ${payload.observacaoAvaria}`);
  } else {
    parts.push('Avaria: NÃO');
  }
  if (payload.observacaoAssistente) parts.push(`Obs. assistente: ${payload.observacaoAssistente}`);
  return `[CHECK-OUT] ${parts.join(' | ')}`;
}

function mergeCheckoutObservations(existing = '', payload = {}) {
  return [String(existing || '').trim(), buildCheckoutObservation(payload)].filter(Boolean).join(' | ');
}

function controladoriaRecipients() {
  return parseEmailList(
    process.env.CONTROLADORIA_EMAIL,
    process.env.CONTROLADORIA_EMAILS,
    process.env.EMAIL_CONTROLADORIA,
    process.env.EMAILS_CONTROLADORIA,
    process.env.CONTROLADORIA_OCORRENCIAS_EMAIL,
    process.env.CONTROLADORIA_OCORRENCIAS_EMAILS,
    process.env.OCORRENCIAS_CONTROLADORIA_EMAIL,
    process.env.OCORRENCIAS_CONTROLADORIA_EMAILS,
    process.env.RECEBIMENTO_OCORRENCIAS_EMAIL,
    process.env.RECEBIMENTO_OCORRENCIAS_EMAILS,
    process.env.OCORRENCIAS_RECEBIMENTO_EMAIL,
    process.env.OCORRENCIAS_RECEBIMENTO_EMAILS,
    process.env.OCORRENCIAS_EMAIL,
    process.env.OCORRENCIAS_EMAILS
  );
}

async function notifyControladoriaAvaria({ agendamento = {}, payload = {}, actor = null, files = [] } = {}) {
  const recipients = controladoriaRecipients();
  if (!payload?.houveAvaria || !recipients.length) {
    return { sent: false, to: recipients.join(', ') || null, reason: payload?.houveAvaria ? 'Destinatário da controladoria não configurado.' : 'Sem avaria informada.' };
  }
  const item = normalizeScheduleItem(agendamento);
  const operador = actor ? String(actor?.nome || actor?.name || actor?.email || actor?.sub || 'Não identificado').trim() : 'Operação pública';
  const notasResumo = buildNotasResumo(item?.notasFiscais || []);
  const anexos = buildAvariaAttachments(files);
  const subject = `Avaria no recebimento - ${item.protocolo || 'sem protocolo'}`;
  const text = [
    'Foi registrada uma avaria no check-out/finalização da descarga.',
    '',
    `Protocolo: ${item.protocolo || '-'}`,
    `Fornecedor: ${item.fornecedor || '-'}`,
    `Transportadora: ${item.transportadora || '-'}`,
    `Motorista: ${item.motorista || '-'}`,
    `Data agendada: ${item.dataAgendada || '-'}`,
    `Hora agendada: ${item.horaAgendada || '-'}`,
    `Como foi a descarga: ${payload.comoFoiDescarga || '-'}`,
    `Item avariado: ${payload.itemAvaria || '-'}`,
    `Quantidade avariada: ${payload.quantidadeAvaria || 0}`,
    `Observação da avaria: ${payload.observacaoAvaria || '-'}`,
    `Observação do assistente: ${payload.observacaoAssistente || '-'}`,
    `NFs relacionadas: ${notasResumo.length ? notasResumo.join('; ') : '-'}`,
    `Imagens anexadas: ${anexos.length ? anexos.map((file) => file.filename).join(', ') : 'Nenhuma'}`,
    `Responsável: ${operador}`
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif"><h2>Avaria registrada no recebimento</h2><p><strong>Protocolo:</strong> ${item.protocolo || '-'}<br><strong>Fornecedor:</strong> ${item.fornecedor || '-'}<br><strong>Transportadora:</strong> ${item.transportadora || '-'}<br><strong>Motorista:</strong> ${item.motorista || '-'}<br><strong>Data agendada:</strong> ${item.dataAgendada || '-'}<br><strong>Hora agendada:</strong> ${item.horaAgendada || '-'}<br><strong>Como foi a descarga:</strong> ${payload.comoFoiDescarga || '-'}<br><strong>Item avariado:</strong> ${payload.itemAvaria || '-'}<br><strong>Quantidade avariada:</strong> ${payload.quantidadeAvaria || 0}<br><strong>Observação da avaria:</strong> ${payload.observacaoAvaria || '-'}<br><strong>Observação do assistente:</strong> ${payload.observacaoAssistente || '-'}<br><strong>Imagens anexadas:</strong> ${anexos.length ? anexos.map((file) => file.filename).join(', ') : 'Nenhuma'}<br><strong>Responsável:</strong> ${operador}</p>${renderNotasResumoHtml(item?.notasFiscais || [])}</div>`;
  const result = await safeAwait(
    () => sendMail({ to: recipients.join(', '), subject, text, html, attachments: anexos }),
    { sent: false, reason: 'Falha ao enviar e-mail para a controladoria.' },
    'notify_controladoria_avaria'
  );
  return { ...result, to: recipients.join(', '), attachments: anexos.map((file) => file.filename) };
}


function gestorAuthorizationRecipients() {
  return parseEmailList(
    process.env.GESTOR_CHECKIN_EMAILS,
    process.env.EMAILS_GESTORES_CHECKIN,
    process.env.GESTOR_LOGISTICA_EMAIL,
    process.env.GESTOR_LOGISTICA_EMAILS,
    process.env.GESTOR_EMAILS,
    process.env.EMAIL_GESTOR,
    process.env.ADMIN_EMAILS,
    process.env.EMAILS_ADMIN,
    process.env.ADMIN_LOGISTICA_EMAILS
  );
}

function buildLinks(req, item) {
  const base = getBaseUrl(req);
  const voucher = canShareVoucher(item)
    ? `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`
    : "";
  return {
    consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`,
    motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`,
    voucher,
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
  const normalized = normalizeScheduleItem(item);
  const data = String(normalized?.dataAgendada || "").trim();
  const hora = String(normalized?.horaAgendada || "").trim();
  if (!data || !hora) return { scheduledAt: null, diffMinutes: null, toleranceMinutes: getToleranceMinutes(), dateMismatch: false, timeMismatch: false, tooEarly: false, tooLate: false };
  const scheduledAt = formatDateTime(`${data}T${hora}:00`);
  if (!scheduledAt) return { scheduledAt: null, diffMinutes: null, toleranceMinutes: getToleranceMinutes(), dateMismatch: false, timeMismatch: false, tooEarly: false, tooLate: false };
  const now = new Date();
  const toleranceMinutes = getToleranceMinutes();
  const diffMinutes = Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
  const dateMismatch = formatDate(now) !== data;
  const tooEarly = diffMinutes < (toleranceMinutes * -1);
  const tooLate = diffMinutes > toleranceMinutes;
  const timeMismatch = tooEarly || tooLate;
  return { scheduledAt, diffMinutes, toleranceMinutes, dateMismatch, timeMismatch, tooEarly, tooLate };
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

function buildTokenCandidates(...values) {
  const items = values
    .flatMap((value) => {
      const parsed = parsePublicOperationReference(value);
      return [parsed.token, String(value || '')];
    })
    .map((value) => String(value || '').replace(/[​-‍﻿\s"'`]+/g, '').trim())
    .filter(Boolean);
  return [...new Set(items.flatMap((value) => [value, value.toUpperCase(), value.toLowerCase()]))];
}

async function resolveByToken(token) {
  const candidates = buildTokenCandidates(token);
  if (!candidates.length) return null;
  try {
    return await prisma.agendamento.findFirst({
      where: {
        OR: candidates.flatMap((candidate) => ([
          { publicTokenFornecedor: candidate },
          { publicTokenMotorista: candidate },
          { checkinToken: candidate },
          { checkoutToken: candidate }
        ]))
      },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
  } catch {
    for (const candidate of candidates) {
      const found = findAgendamentoByTokenFile(candidate);
      if (found) return found;
    }
    return null;
  }
}

async function resolveOperationItem(rawToken, lookupId = "") {
  const foundByToken = await resolveByToken(rawToken);
  if (foundByToken) return foundByToken;
  const numericId = Number(String(lookupId || '').replace(/\D/g, '').trim());
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  try {
    return await prisma.agendamento.findUnique({ where: { id: numericId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
  } catch {
    return readAgendamentos().find((item) => Number(item?.id || 0) === numericId) || null;
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

async function sendScheduleCreatedNotice(item, req) {
  if (!item?.emailTransportadora) {
    return { sent: false, reason: "Não há e-mail da transportadora/fornecedor cadastrado." };
  }

  const links = buildLinks(req, item);
  const textoDoca = item.doca?.codigo || item.doca || "A DEFINIR";
  return sendMail({
    to: item.emailTransportadora,
    subject: `Solicitação de agendamento recebida ${item.protocolo}`,
    text: `Solicitação registrada para ${item.dataAgendada || "-"} às ${item.horaAgendada || "-"}.
Protocolo: ${item.protocolo}
Status atual: ${item.status || "PENDENTE_APROVACAO"}
Doca: ${textoDoca}
Token de consulta da transportadora: ${item.publicTokenFornecedor}
Consulta do agendamento: ${links.consulta}

O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.`,
    html: `<p>Solicitação registrada para <strong>${item.dataAgendada || "-"}</strong> às <strong>${item.horaAgendada || "-"}</strong>.</p><p><strong>Protocolo:</strong> ${item.protocolo}<br><strong>Status atual:</strong> ${item.status || "PENDENTE_APROVACAO"}<br><strong>Doca:</strong> ${textoDoca}<br><strong>Token de consulta da transportadora:</strong> ${item.publicTokenFornecedor}</p><p><a href="${links.consulta}">Consultar agendamento</a></p><p>O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.</p>`
  }).then((result) => ({ ...result, to: item.emailTransportadora, consulta: links.consulta, tokenConsulta: item.publicTokenFornecedor }));
}

function buildManualAuthorizationMail(item, req, windowInfo) {
  const baseUrl = getBaseUrl(req);
  const links = buildLinks(req, item);
  const diff = Number(windowInfo?.diffMinutes || 0);
  const antecedencia = diff < 0 ? Math.abs(diff) : 0;
  const profileHint = "ADMIN, GESTOR, OPERADOR ou PORTARIA";
  return {
    subject: `Autorização manual de check-in antecipado - ${item.protocolo}`,
    text: [
      "Foi bloqueada uma tentativa de check-in antecipado acima da tolerância permitida.",
      "",
      `Protocolo: ${item.protocolo}`,
      `Fornecedor: ${item.fornecedor || "-"}`,
      `Transportadora: ${item.transportadora || "-"}`,
      `Motorista: ${item.motorista || "-"}`,
      `Placa: ${item.placa || "-"}`,
      `Data agendada: ${item.dataAgendada || "-"}`,
      `Hora agendada: ${item.horaAgendada || "-"}`,
      `Antecedência detectada: ${antecedencia} minuto(s)`,
      `Tolerância permitida: ${windowInfo?.toleranceMinutes ?? 0} minuto(s)`,
      `Token de check-in: ${item.checkinToken || "-"}`,
      `Token de consulta: ${item.publicTokenFornecedor || "-"}`,
      `Consulta do agendamento: ${links.consulta}`,
      `Tela de check-in: ${baseUrl}/?view=checkin&token=${encodeURIComponent(item.checkinToken || "")}`,
      "",
      `Para autorizar manualmente, acesse o sistema com perfil ${profileHint} e valide o check-in com override manual.`
    ].join("\n"),
    html: `<div style="font-family:Arial,sans-serif"><h2>Autorização manual de check-in antecipado</h2><p>Foi bloqueada uma tentativa de <strong>check-in antecipado</strong> acima da tolerância permitida.</p><p><strong>Protocolo:</strong> ${item.protocolo}<br><strong>Fornecedor:</strong> ${item.fornecedor || "-"}<br><strong>Transportadora:</strong> ${item.transportadora || "-"}<br><strong>Motorista:</strong> ${item.motorista || "-"}<br><strong>Placa:</strong> ${item.placa || "-"}<br><strong>Data agendada:</strong> ${item.dataAgendada || "-"}<br><strong>Hora agendada:</strong> ${item.horaAgendada || "-"}<br><strong>Antecedência detectada:</strong> ${antecedencia} minuto(s)<br><strong>Tolerância permitida:</strong> ${windowInfo?.toleranceMinutes ?? 0} minuto(s)<br><strong>Token de check-in:</strong> ${item.checkinToken || "-"}<br><strong>Token de consulta:</strong> ${item.publicTokenFornecedor || "-"}</p><p><a href="${links.consulta}">Consultar agendamento</a></p><p>Para autorizar manualmente, acesse o sistema com perfil <strong>${profileHint}</strong> e valide o check-in com override manual.</p></div>`
  };
}

async function notifyGestorAboutEarlyCheckin(item, req, windowInfo) {
  const recipients = gestorAuthorizationRecipients();
  if (!recipients.length) return { sent: false, reason: "E-mails do gestor não configurados.", to: null };
  const mail = buildManualAuthorizationMail(item, req, windowInfo);
  return safeAwait(
    () => sendMail({
      to: recipients.join(", "),
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    }).then((result) => ({ ...result, to: recipients.join(", ") })),
    { sent: false, reason: "Falha ao notificar o gestor.", to: recipients.join(", ") },
    'notify_gestor_checkin'
  );
}

router.get("/disponibilidade", asyncRoute(async (req, res) => {
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
        const slotFuturo = isCurrentDaySlotFuture(data, parsed.horaInicio);
        const disponivel = slotFuturo && ocupadosJanela === 0 ? 1 : 0;
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || "",
          ocupados: ocupadosJanela,
          disponivel,
          ativo: disponivel > 0
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
        const slotFuturo = isCurrentDaySlotFuture(data, parsed.horaInicio);
        const disponivel = slotFuturo && ocupados === 0 ? 1 : 0;
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || "",
          ocupados,
          disponivel,
          ativo: disponivel > 0
        };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    });
    return res.json({ agenda, meta: { dias, origem: "arquivo" } });
  }
}));

router.get("/relatorio-status", asyncRoute(async (_req, res) => {
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
}));

router.get("/fornecedores-pendentes", asyncRoute(async (_req, res) => {
  try {
    await ensureLatestRelatorioImport({ forceIfEmpty: true });
    return res.json(await listFornecedoresPendentesImportados());
  } catch (error) {
    console.error("[RELATORIO_IMPORT] Falha ao montar fornecedores pendentes:", error?.message || error);
    return res.json(readFornecedoresPendentes());
  }
}));

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
          observacao: encodeNotaObservacao(nota)
        }))
      });
    }

    return created.id;
  });

  return prisma.agendamento.findUnique({ where: { id: createdId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
}

router.post("/solicitacao", asyncRoute(async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const janelaId = Number(payload.janelaId);
    if (!janelaId) return res.status(400).json({ message: "Janela é obrigatória." });
    const cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    const notas = Array.isArray(payload.notas)
      ? payload.notas.map((nota) => ({
          numeroNf: String(nota?.numeroNf || "").trim(),
          serie: String(nota?.serie || "").trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: encodeNotaObservacao(nota)
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
      motorista: String(payload.motorista || '').trim() || 'NÃO INFORMADO',
      cpfMotorista,
      telefoneMotorista: String(payload.telefoneMotorista || "").trim(),
      emailMotorista: String(payload.emailMotorista || "").trim(),
      emailTransportadora: String(payload.emailTransportadora || "").trim(),
      placa: String(payload.placa || '').trim().toUpperCase() || 'NÃO INFORMADA',
      dataAgendada: String(payload.dataAgendada || "").trim(),
      horaAgendada,
      janelaId,
      docaId: doca.id,
      observacoes: String(payload.observacoes || "").trim(),
      lgpdConsent: Boolean(payload.lgpdConsent),
      ...totals
    };
    validateAgendamentoPayload(agendamentoPayload, true);

    await assertJanelaDocaDisponivel({ docaId: doca.id, janelaId, dataAgendada: agendamentoPayload.dataAgendada });

    try {
      const full = await createPublicAgendamentoInDatabase({ agendamentoPayload, notas, cpfMotorista });
      const links = buildLinks(req, full);
      const notificacaoCriacao = await sendScheduleCreatedNotice(full, req);
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
        tokenCheckout: full.checkoutToken,
        notificacaoCriacao
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
      const notificacaoCriacao = await sendScheduleCreatedNotice(record, req);
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
        notificacaoCriacao,
        origem: "arquivo"
      });
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
}));

router.get("/motorista/:token", asyncRoute(async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json({ ...formatItem(item, req), cancelamento: canDriverCancel(item) });
}));

router.post("/motorista/:token/cancelar", asyncRoute(async (req, res) => {
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
}));

router.get("/consulta/:token", asyncRoute(async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json(formatItem(item, req));
}));

router.get("/fornecedor/:token", asyncRoute(async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json(formatItem(item, req));
}));

router.get("/voucher/:token", asyncRoute(async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: "Token inválido." });
  const normalizedItem = normalizeScheduleItem(item);
  if (!canShareVoucher(normalizedItem)) return res.status(403).json({ message: "O voucher só fica disponível após a aprovação do agendamento." });
  const pdf = await generateVoucherPdf(normalizedItem, { baseUrl: getBaseUrl(req) });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=voucher-${normalizedItem.protocolo}.pdf`);
  res.send(pdf);
}));

router.get("/avaliacao/:token", asyncRoute(async (req, res) => {
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
}));

router.post("/avaliacao/:token", asyncRoute(async (req, res) => {
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
}));

router.post("/checkin/:token", asyncRoute(async (req, res) => {
  const actor = getOptionalActor(req);
  const operationRef = parsePublicOperationReference(req.body?.rawToken || req.body?.token || req.query?.token || req.params.token);
  const lookupId = String(req.body?.lookupId || req.query?.id || operationRef.id || '').trim();
  const item = await resolveOperationItem(operationRef.token || req.params.token, lookupId);
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });
  if (!["APROVADO", "CHEGOU"].includes(item.status)) return res.status(400).json({ message: "Check-in só permitido para agendamentos aprovados." });

  const windowInfo = buildCheckinWindow(item);
  const requiresManualAuthorization = !!(windowInfo.dateMismatch || windowInfo.timeMismatch);
  const requiresGestorAuthorization = !!windowInfo.tooEarly;
  const overrideRequested = !!(req.body?.overrideDateMismatch || req.body?.overrideTimeMismatch || req.body?.overrideManualAuthorization);

  if (requiresManualAuthorization && !overrideRequested) {
    const gestorNotification = requiresGestorAuthorization
      ? await notifyGestorAboutEarlyCheckin(item, req, windowInfo)
      : { sent: false, reason: "Notificação ao gestor não necessária.", to: null };

    await safeAwait(() => logPublicAction({
      actor,
      action: requiresGestorAuthorization ? "SOLICITAR_AUTORIZACAO_CHECKIN_ANTECIPADO" : "BLOQUEAR_CHECKIN_FORA_JANELA",
      item,
      req,
      details: {
        origem: "qr-code",
        dateMismatch: windowInfo.dateMismatch,
        timeMismatch: windowInfo.timeMismatch,
        tooEarly: windowInfo.tooEarly,
        tooLate: windowInfo.tooLate,
        toleranceMinutes: windowInfo.toleranceMinutes,
        diffMinutes: windowInfo.diffMinutes,
        gestorNotification
      }
    }), null, 'audit_checkin_bloqueado');

    const baseMessage = buildCheckinMismatchMessage(item, windowInfo);
    const managerMessage = requiresGestorAuthorization
      ? `${baseMessage} O gestor foi notificado para autorização manual.`
      : baseMessage;

    return res.status(409).json({
      message: managerMessage,
      requiresManualAuthorization: true,
      requiresGestorAuthorization,
      dateMismatch: windowInfo.dateMismatch,
      timeMismatch: windowInfo.timeMismatch,
      tooEarly: windowInfo.tooEarly,
      tooLate: windowInfo.tooLate,
      toleranceMinutes: windowInfo.toleranceMinutes,
      diffMinutes: windowInfo.diffMinutes,
      gestorNotification
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
  await safeAwait(() => logPublicAction({
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
  }), null, 'audit_checkin_qr');

  return res.json({
    ok: true,
    message: requiresManualAuthorization ? "Check-in realizado com liberação manual do operador." : "Check-in realizado com sucesso.",
    agendamento: updated,
    requiresManualAuthorization: false
  });
}));

router.post('/checkout/:token', publicAvariaUpload.fields([{ name: 'imagensAvaria', maxCount: 10 }]), asyncRoute(async (req, res) => {
  const actor = getOptionalActor(req);
  const operationRef = parsePublicOperationReference(req.body?.rawToken || req.body?.token || req.query?.token || req.params.token);
  const lookupId = String(req.body?.lookupId || req.query?.id || operationRef.id || '').trim();
  const item = await resolveOperationItem(operationRef.token || req.params.token, lookupId);
  if (!item) return res.status(404).json({ message: 'Token de check-out inválido.' });
  if (item.status === 'CHEGOU') {
    return res.status(409).json({
      message: 'O check-out por token/QR só pode ser executado após o início da descarga. Use o botão Iniciar descarga antes de validar o check-out, ou finalize pelo painel interno.',
      requiresStartUnload: true,
      currentStatus: item.status,
      agendamento: normalizeScheduleItem(item)
    });
  }
  if (item.status !== 'EM_DESCARGA') {
    return res.status(400).json({ message: 'Check-out por token/QR só permitido para agendamentos em descarga.' });
  }

  const avaliacaoRecebimento = normalizeCheckoutPayload(req.body || {});
  const imagensAvaria = uploadedAvariaFilesFromReq(req);

  let updated;
  const mergedObservacoes = mergeCheckoutObservations(item.observacoes, avaliacaoRecebimento);
  try {
    updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: {
        status: 'FINALIZADO',
        fimDescargaEm: new Date(),
        observacoes: mergedObservacoes
      }
    });
  } catch {
    updated = updateAgendamentoFile(item.id, {
      status: 'FINALIZADO',
      fimDescargaEm: new Date().toISOString(),
      observacoes: mergedObservacoes
    });
  }

  const normalizedUpdated = normalizeScheduleItem({ ...item, ...updated }, item);
  const survey = await safeAwait(
    () => sendDriverFeedbackRequestEmail({
      agendamento: normalizedUpdated,
      baseUrl: getBaseUrl(req)
    }),
    { sent: false, reason: 'Falha ao disparar avaliação do motorista.', to: null, feedbackLink: null, token: null },
    'send_driver_feedback_checkout'
  );

  const ocorrenciaRecebimento = await safeAwait(
    () => notifyControladoriaAvaria({
      agendamento: normalizedUpdated,
      payload: avaliacaoRecebimento,
      actor,
      files: imagensAvaria
    }),
    { sent: false, to: null, reason: 'Falha ao enviar ocorrência para a controladoria.' },
    'notify_controladoria_checkout'
  );

  await safeAwait(() => logPublicAction({
    actor,
    action: 'CHECKOUT_QR',
    item: updated,
    req,
    details: {
      origem: 'qr-code',
      surveySent: !!survey?.sent,
      surveyTo: survey?.to || null,
      feedbackLink: survey?.feedbackLink || null,
      surveyReason: survey?.reason || null,
      avaliacaoRecebimento,
      ocorrenciaRecebimento,
      imagensAvaria: imagensAvaria.map((file) => file.originalname || file.filename)
    }
  }), null, 'audit_checkout_qr');

  return res.json({ ok: true, message: 'Check-out realizado com sucesso.', agendamento: normalizedUpdated, avaliacao: survey, avaliacaoRecebimento, ocorrenciaRecebimento, imagensAvaria: imagensAvaria.map((file) => ({ nome: file.originalname || file.filename, caminho: file.path })) });
}));

export default router;
