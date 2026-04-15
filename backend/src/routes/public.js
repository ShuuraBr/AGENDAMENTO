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
import { encodeNotaObservacao } from "../utils/nota-metadata.js";
import { sendMail } from "../utils/email.js";
import { createAvariaImageUpload, wrapMulter, AVARIA_IMAGE_MAX_COUNT } from "../utils/upload-policy.js";
import { logTechnicalEvent } from "../utils/telemetry.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];
const MANUAL_AUTH_PROFILES = ["ADMIN", "OPERADOR", "GESTOR", "PORTARIA"];
const VOUCHER_ALLOWED_STATUSES = new Set(["APROVADO", "CHEGOU", "EM_DESCARGA", "FINALIZADO"]);
const publicAvariaUpload = createAvariaImageUpload();
const publicAvariaUploadMiddleware = wrapMulter(publicAvariaUpload.fields([{ name: "imagensAvaria", maxCount: AVARIA_IMAGE_MAX_COUNT }]));

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

function normalizeScheduleDateValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return formatDate(native);
  return raw;
}

function normalizeScheduleTimeValue(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (match) return `${match[1]}:${match[2]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    return `${String(native.getUTCHours()).padStart(2, '0')}:${String(native.getUTCMinutes()).padStart(2, '0')}`;
  }
  return raw;
}

function deriveHoraFromJanela(item = {}) {
  const horaDireta = String(item?.janela?.horaInicio || item?.janela?.hora_inicio || item?.horaInicio || item?.hora_inicio || '').trim();
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(horaDireta)) return horaDireta.slice(0, 5);
  const janelaCodigo = String(item?.janela?.codigo || item?.janela || item?.janelaCodigo || '').trim();
  const match = janelaCodigo.match(/(\d{2}:\d{2})/);
  return match?.[1] || '';
}

function isMissingScheduleValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || ['-', 'invalid date', 'null', 'undefined'].includes(normalized);
}

function pickScheduleDateCandidate(source = {}) {
  return source?.dataAgendada
    ?? source?.data_agendada
    ?? source?.dataProgramada
    ?? source?.data_programada
    ?? source?.dataAgendamento
    ?? source?.data_agendamento_janela
    ?? source?.janela?.dataAgendamento
    ?? source?.janela?.data_agendamento
    ?? source?.agendamento?.dataAgendada
    ?? source?.agendamento?.data_agendada
    ?? source?.data
    ?? source?.date
    ?? '';
}

function pickScheduleTimeCandidate(source = {}) {
  return source?.horaAgendada
    ?? source?.hora_agendada
    ?? source?.horaProgramada
    ?? source?.hora_programada
    ?? source?.horaInicio
    ?? source?.hora_inicio
    ?? source?.janela?.horaInicio
    ?? source?.janela?.hora_inicio
    ?? source?.agendamento?.horaAgendada
    ?? source?.agendamento?.hora_agendada
    ?? source?.hora
    ?? source?.time
    ?? '';
}

function resolveScheduleValues(item = {}, fallback = null) {
  const primaryDateCandidate = pickScheduleDateCandidate(item);
  const fallbackDateCandidate = pickScheduleDateCandidate(fallback || {});
  const primaryTimeCandidate = pickScheduleTimeCandidate(item);
  const fallbackTimeCandidate = pickScheduleTimeCandidate(fallback || {});
  const dataAgendada = normalizeScheduleDateValue(isMissingScheduleValue(primaryDateCandidate) ? fallbackDateCandidate : primaryDateCandidate)
    || normalizeScheduleDateValue(fallbackDateCandidate);
  const horaAgendada = normalizeScheduleTimeValue(isMissingScheduleValue(primaryTimeCandidate) ? fallbackTimeCandidate : primaryTimeCandidate)
    || normalizeScheduleTimeValue(fallbackTimeCandidate)
    || deriveHoraFromJanela(item)
    || deriveHoraFromJanela(fallback || {});
  return { dataAgendada, horaAgendada };
}

function normalizeScheduleItem(item = {}, fallback = null) {
  const resolved = resolveScheduleValues(item, fallback);
  return { ...fallback, ...item, ...resolved };
}

function parseBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'sim', 's', 'yes', 'y', 'on'].includes(normalized);
}

function normalizeAvariaItems(value, fallbackItem = '', fallbackQuantity = '') {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        const parsedEntry = typeof entry === 'string'
          ? (() => { try { return JSON.parse(entry); } catch { return { produto: entry, quantidade: '' }; } })()
          : entry;
        return {
          produto: String(parsedEntry?.produto || parsedEntry?.item || '').trim(),
          quantidade: String(parsedEntry?.quantidade || parsedEntry?.qtd || '').trim(),
          observacao: String(parsedEntry?.observacao || parsedEntry?.obs || parsedEntry?.detalhe || '').trim()
        };
      })
      .filter((entry) => entry.produto || entry.quantidade);
  }

  const parsed = (() => {
    if (typeof value !== 'string') return null;
    const raw = String(value || '').trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  })();

  if (Array.isArray(parsed)) return normalizeAvariaItems(parsed, fallbackItem, fallbackQuantity);
  if (parsed && typeof parsed === 'object') return normalizeAvariaItems([parsed], fallbackItem, fallbackQuantity);

  const item = String(fallbackItem || '').trim();
  const quantity = String(fallbackQuantity || '').trim();
  return item || quantity ? [{ produto: item, quantidade: quantity, observacao: '' }] : [];
}

function normalizeAvariaType(value = '') {
  return String(value || '').trim().toUpperCase();
}

function normalizeRecebimentoOrigin(value = '') {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === '1') return 'MATRIZ';
  if (normalized === '2') return 'FILIAL';
  return normalized;
}

function formatScheduleDateLabel(value) {
  const normalized = normalizeScheduleDateValue(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (normalized || '-');
}

function buildAvariaItemsText(avarias = []) {
  const items = Array.isArray(avarias) ? avarias : [];
  if (!items.length) return 'Nenhum produto informado.';
  return items.map((entry) => `- ${entry.produto || '-'} | Quantidade: ${entry.quantidade || '-'}${entry.observacao ? ` | Observação: ${entry.observacao}` : ''}`).join('\n');
}

function buildAvariaItemsHtml(avarias = []) {
  const items = Array.isArray(avarias) ? avarias : [];
  if (!items.length) return '<li>Nenhum produto informado.</li>';
  return items.map((entry) => `<li><strong>${entry.produto || '-'}</strong> | Quantidade: ${entry.quantidade || '-'}${entry.observacao ? ` | Observação: ${entry.observacao}` : ''}</li>`).join('');
}

function normalizeCheckoutPayload(body = {}) {
  const avarias = normalizeAvariaItems(
    body?.avarias,
    body?.itemAvaria || body?.item,
    body?.quantidadeAvaria || body?.quantidade
  );
  const payload = {
    comoFoiDescarga: String(body?.comoFoiDescarga || body?.descargaConcluida || '').trim() || 'Concluída',
    houveAvaria: parseBooleanLike(body?.houveAvaria ?? body?.teveOcorrencia),
    tipoAvaria: normalizeAvariaType(body?.tipoAvaria || body?.tipoOcorrencia),
    origemRecebimento: normalizeRecebimentoOrigin(body?.origemRecebimento || body?.localRecebimento || body?.recebidoEm),
    avarias,
    itemAvaria: String(avarias?.[0]?.produto || body?.itemAvaria || '').trim(),
    quantidadeAvaria: String(avarias?.[0]?.quantidade || body?.quantidadeAvaria || '').trim(),
    observacaoAvaria: String(body?.observacaoAvaria || body?.descricaoOcorrencia || '').trim(),
    observacaoAssistente: String(body?.observacaoAssistente || '').trim(),
    motoristaTranquilo: String(body?.motoristaTranquilo || '').trim(),
    cargaBatida: String(body?.cargaBatida || '').trim()
  };
  if (payload.houveAvaria) {
    const hasInvalidItems = !payload.avarias.length || payload.avarias.some((entry) => !entry.produto || !entry.quantidade || Number(entry.quantidade) <= 0);
    if (!payload.tipoAvaria || !payload.origemRecebimento || hasInvalidItems) {
      throw new Error('Preencha o tipo da avaria, a origem do recebimento e todos os produtos com quantidade antes de concluir o check-out.');
    }
  }
  return payload;
}

function buildCheckoutObservation(payload = {}) {
  const parts = [];
  if (payload?.comoFoiDescarga) parts.push(`Descarga: ${payload.comoFoiDescarga}`);
  if (payload?.observacaoAssistente) parts.push(`Assistente: ${payload.observacaoAssistente}`);
  if (payload?.motoristaTranquilo) parts.push(`Motorista tranquilo: ${payload.motoristaTranquilo}`);
  if (payload?.cargaBatida) parts.push(`Carga batida: ${payload.cargaBatida}`);
  if (payload?.houveAvaria) {
    parts.push(`Tipo avaria: ${payload.tipoAvaria || '-'}`);
    parts.push(`Origem recebimento: ${payload.origemRecebimento || '-'}`);
    const avarias = Array.isArray(payload?.avarias) ? payload.avarias : [];
    parts.push(`Produtos: ${avarias.map((entry) => `${entry.produto || '-'} (${entry.quantidade || '-'})${entry.observacao ? ` - ${entry.observacao}` : ''}`).join(', ') || '-'}`);
    if (payload?.observacaoAvaria) parts.push(`Obs. avaria: ${payload.observacaoAvaria}`);
  }
  return parts.join(' | ');
}

function mergeCheckoutObservations(existing = '', payload = {}) {
  return [String(existing || '').trim(), buildCheckoutObservation(payload)].filter(Boolean).join(' | ');
}

function uploadedAvariaFilesFromReq(req) {
  const entries = req?.files?.imagensAvaria;
  return Array.isArray(entries) ? entries.filter(Boolean) : [];
}

function buildAvariaAttachments(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => ({
    filename: file.originalname,
    path: file.path,
    contentType: file.mimetype || undefined
  }));
}

function buildNotasResumo(notas = []) {
  return (Array.isArray(notas) ? notas : []).map((nota) => ({
    numeroNf: String(nota?.numeroNf || '-'),
    serie: String(nota?.serie || '-'),
    volumes: Number(nota?.volumes || 0),
    peso: Number(nota?.peso || 0),
    itens: Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0)
  }));
}

function renderNotasResumoHtml(notas = []) {
  const rows = buildNotasResumo(notas).map((nota) => `
    <tr>
      <td style="padding:8px;border:1px solid #e2e8f0">${nota.numeroNf}</td>
      <td style="padding:8px;border:1px solid #e2e8f0">${nota.serie}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${nota.volumes}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${nota.peso}</td>
      <td style="padding:8px;border:1px solid #e2e8f0;text-align:right">${nota.itens}</td>
    </tr>
  `).join('');
  if (!rows) return '<p><strong>NFs:</strong> não informadas.</p>';
  return `<table style="border-collapse:collapse;width:100%;margin-top:12px"><thead><tr><th style="padding:8px;border:1px solid #e2e8f0">NF</th><th style="padding:8px;border:1px solid #e2e8f0">Série</th><th style="padding:8px;border:1px solid #e2e8f0">Volumes</th><th style="padding:8px;border:1px solid #e2e8f0">Peso</th><th style="padding:8px;border:1px solid #e2e8f0">Itens</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function controladoriaRecipients() {
  return parseEmailList(
    process.env.CONTROLADORIA_EMAIL,
    process.env.CONTROLADORIA_EMAILS,
    process.env.EMAIL_CONTROLADORIA,
    process.env.EMAILS_CONTROLADORIA,
    process.env.CONTROLADORIA_OCORRENCIAS_EMAIL,
    process.env.CONTROLADORIA_OCORRENCIAS_EMAILS,
    process.env.CONTROLADORIA_OCORRENCIA_EMAIL,
    process.env.CONTROLADORIA_OCORRENCIA_EMAILS,
    process.env.CONTROLADORIA_AVARIA_EMAIL,
    process.env.CONTROLADORIA_AVARIA_EMAILS,
    process.env.OCORRENCIAS_CONTROLADORIA_EMAIL,
    process.env.OCORRENCIAS_CONTROLADORIA_EMAILS,
    process.env.OCORRENCIA_CONTROLADORIA_EMAIL,
    process.env.OCORRENCIA_CONTROLADORIA_EMAILS,
    process.env.RECEBIMENTO_OCORRENCIAS_EMAIL,
    process.env.RECEBIMENTO_OCORRENCIAS_EMAILS,
    process.env.OCORRENCIAS_RECEBIMENTO_EMAIL,
    process.env.OCORRENCIAS_RECEBIMENTO_EMAILS,
    process.env.OCORRENCIAS_EMAIL,
    process.env.OCORRENCIAS_EMAILS,
    process.env.OCORRENCIA_EMAIL,
    process.env.OCORRENCIA_EMAILS,
    process.env.AVARIA_EMAIL,
    process.env.AVARIA_EMAILS,
    process.env.AVARIAS_EMAIL,
    process.env.AVARIAS_EMAILS
  );
}

async function notifyControladoriaAvaria({ agendamento, payload, actor = null, files = [] } = {}) {
  if (!payload?.houveAvaria) return { sent: false, to: null, reason: 'Sem avaria informada.' };
  const recipients = controladoriaRecipients();
  if (!recipients.length) return { sent: false, to: null, reason: 'E-mails da controladoria não configurados.' };
  const item = normalizeScheduleItem(agendamento);
  const notasHtml = renderNotasResumoHtml(item?.notasFiscais || []);
  const notasText = buildNotasResumo(item?.notasFiscais || []).map((nota) => `NF ${nota.numeroNf} | Série ${nota.serie} | Vol ${nota.volumes} | Peso ${nota.peso} | Itens ${nota.itens}`).join('\n') || 'NFs não informadas.';
  const actorLabel = String(actor?.nome || actor?.name || actor?.email || actor?.sub || 'Não identificado').trim();
  const attachments = buildAvariaAttachments(files);
  const avariasText = buildAvariaItemsText(payload?.avarias || []);
  const avariasHtml = buildAvariaItemsHtml(payload?.avarias || []);
  const sent = await sendMail({
    to: recipients.join(', '),
    subject: `Avaria registrada no recebimento - ${item.protocolo || item.id || 'sem protocolo'}`,
    text: [
      'Foi registrada uma avaria no recebimento.',
      '',
      `Protocolo: ${item.protocolo || '-'}`,
      `Fornecedor: ${item.fornecedor || '-'}`,
      `Transportadora: ${item.transportadora || '-'}`,
      `Motorista: ${item.motorista || '-'}`,
      `Placa: ${item.placa || '-'}`,
      `Data agendada: ${formatScheduleDateLabel(item.dataAgendada)}`,
      `Hora agendada: ${item.horaAgendada || '-'}`,
      `Como foi a descarga: ${payload.comoFoiDescarga || '-'}`,
      `Tipo de avaria: ${payload.tipoAvaria || '-'}`,
      `Recebido em: ${payload.origemRecebimento || '-'}`,
      'Produtos informados:',
      avariasText,
      `Observação da avaria: ${payload.observacaoAvaria || '-'}`,
      `Observação do assistente: ${payload.observacaoAssistente || '-'}`,
      `Operador responsável: ${actorLabel}`,
      '',
      'Notas fiscais:',
      notasText
    ].join('\n'),
    html: `<div style="font-family:Arial,sans-serif"><h2>Avaria registrada no recebimento</h2><p><strong>Protocolo:</strong> ${item.protocolo || '-'}<br><strong>Fornecedor:</strong> ${item.fornecedor || '-'}<br><strong>Transportadora:</strong> ${item.transportadora || '-'}<br><strong>Motorista:</strong> ${item.motorista || '-'}<br><strong>Placa:</strong> ${item.placa || '-'}<br><strong>Data agendada:</strong> ${formatScheduleDateLabel(item.dataAgendada)}<br><strong>Hora agendada:</strong> ${item.horaAgendada || '-'}<br><strong>Como foi a descarga:</strong> ${payload.comoFoiDescarga || '-'}<br><strong>Tipo de avaria:</strong> ${payload.tipoAvaria || '-'}<br><strong>Recebido em:</strong> ${payload.origemRecebimento || '-'}<br><strong>Observação da avaria:</strong> ${payload.observacaoAvaria || '-'}<br><strong>Observação do assistente:</strong> ${payload.observacaoAssistente || '-'}<br><strong>Operador responsável:</strong> ${actorLabel}</p><p><strong>Produtos informados:</strong></p><ul>${avariasHtml}</ul>${notasHtml}</div>`,
    attachments: attachments.length ? attachments : undefined
  });
  return { ...sent, to: recipients.join(', '), attachments: attachments.map((item) => item.filename) };
}

function parseEmailList(...values) {
  const emails = values
    .flatMap((value) => String(value || "").split(/[;,]/))
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return [...new Set(emails)];
}

function gestorAuthorizationRecipients() {
  return parseEmailList(
    process.env.GESTOR_CHECKIN_EMAILS,
    process.env.EMAILS_GESTORES_CHECKIN,
    process.env.GESTOR_LOGISTICA_EMAIL,
    process.env.GESTOR_LOGISTICA_EMAILS,
    process.env.GESTOR_EMAILS,
    process.env.EMAIL_GESTOR
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
  const data = String(item?.dataAgendada || "").trim();
  const hora = String(item?.horaAgendada || "").trim();
  const toleranceMinutes = getToleranceMinutes();
  if (!data || !hora) {
    return { scheduledAt: null, diffMinutes: null, toleranceMinutes, dateMismatch: true, timeMismatch: true, tooEarly: false, tooLate: false, missingSchedule: true, hasSchedule: false };
  }
  const scheduledAt = formatDateTime(`${data}T${hora}:00`);
  if (!scheduledAt) {
    return { scheduledAt: null, diffMinutes: null, toleranceMinutes, dateMismatch: true, timeMismatch: true, tooEarly: false, tooLate: false, missingSchedule: true, hasSchedule: false };
  }
  const now = new Date();
  const diffMinutes = Math.round((now.getTime() - scheduledAt.getTime()) / 60000);
  const dateMismatch = formatDate(now) !== data;
  const tooEarly = diffMinutes < (toleranceMinutes * -1);
  const tooLate = diffMinutes > toleranceMinutes;
  const timeMismatch = tooEarly || tooLate;
  return { scheduledAt, diffMinutes, toleranceMinutes, dateMismatch, timeMismatch, tooEarly, tooLate, missingSchedule: false, hasSchedule: true };
}

function buildCheckinMismatchMessage(item, windowInfo) {
  if (windowInfo?.missingSchedule) {
    return 'Não foi possível confirmar a data e o horário agendados deste recebimento. O check-in precisa de validação manual por operador autorizado.';
  }
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


function normalizeLookupIdentity(value = '') {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').trim().toUpperCase();
}

function extractTokenSeed(token = '') {
  const normalized = String(token || '').trim().toUpperCase();
  const match = normalized.match(/^[A-Z]+-([A-Z0-9]+)-[A-Z0-9]+$/);
  return match?.[1] || '';
}

function scoreOperationSeedMatch(item = {}, seed = '') {
  const normalizedSeed = normalizeLookupIdentity(seed);
  if (!normalizedSeed) return 0;
  const protocolo = normalizeLookupIdentity(item?.protocolo || '');
  if (protocolo && (protocolo === normalizedSeed || protocolo.includes(normalizedSeed) || normalizedSeed.includes(protocolo))) return 100;
  const cpf = normalizeLookupIdentity(String(item?.cpfMotorista || '').replace(/\D/g, ''));
  if (cpf && cpf === normalizedSeed) return 90;
  const placa = normalizeLookupIdentity(item?.placa || '');
  if (placa && placa === normalizedSeed) return 80;
  const fornecedorToken = normalizeLookupIdentity(item?.publicTokenFornecedor || '');
  if (fornecedorToken && fornecedorToken.includes(normalizedSeed)) return 60;
  const motoristaToken = normalizeLookupIdentity(item?.publicTokenMotorista || '');
  if (motoristaToken && motoristaToken.includes(normalizedSeed)) return 60;
  return 0;
}

async function resolveByTokenSeed(seed = '') {
  const normalizedSeed = normalizeLookupIdentity(seed);
  if (!normalizedSeed) return null;
  try {
    const rows = await prisma.agendamento.findMany({ include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
    const scored = rows
      .map((item) => ({ item, score: scoreOperationSeedMatch(item, normalizedSeed) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.item?.id || 0) - Number(a.item?.id || 0));
    return scored[0]?.item || null;
  } catch {
    const scored = readAgendamentos()
      .map((item) => ({ item, score: scoreOperationSeedMatch(item, normalizedSeed) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.item?.id || 0) - Number(a.item?.id || 0));
    return scored[0]?.item || null;
  }
}

async function resolveByToken(token) {
  const candidates = buildTokenCandidates(token);
  if (!candidates.length) return null;
  try {
    const found = await prisma.agendamento.findFirst({
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
    if (found) return found;
  } catch {
    for (const candidate of candidates) {
      const found = findAgendamentoByTokenFile(candidate);
      if (found) return found;
    }
  }

  for (const candidate of candidates) {
    const seedFound = await resolveByTokenSeed(extractTokenSeed(candidate));
    if (seedFound) return seedFound;
  }
  return null;
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


async function loadAgendamentoSnapshot(id, fallback = null) {
  const numericId = Number(id || 0);
  if (!Number.isFinite(numericId) || numericId <= 0) return fallback;
  try {
    return await prisma.agendamento.findUnique({ where: { id: numericId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } }) || fallback;
  } catch {
    return readAgendamentos().find((item) => Number(item?.id || 0) === numericId) || fallback;
  }
}

function tokenMatchesExpectedPrefix(token = '', expectedPrefix = '') {
  const normalizedToken = String(token || '').trim().toUpperCase();
  const normalizedPrefix = String(expectedPrefix || '').trim().toUpperCase();
  if (!normalizedToken || !normalizedPrefix) return false;
  return normalizedToken.startsWith(`${normalizedPrefix}-`);
}

async function findOperationItemById(lookupId = '') {
  const numericId = Number(String(lookupId || '').replace(/\D/g, '').trim());
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  try {
    return await prisma.agendamento.findUnique({ where: { id: numericId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
  } catch (error) {
    logTechnicalEvent('operation-id-fallback', { lookupId: String(lookupId || ''), reason: error?.message || String(error) });
    return readAgendamentos().find((item) => Number(item?.id || 0) === numericId) || null;
  }
}

async function ensureOperationScheduleContext(item = {}, fallback = null) {
  const normalized = normalizeScheduleItem(item, fallback);
  if (!isMissingScheduleValue(normalized?.dataAgendada) && !isMissingScheduleValue(normalized?.horaAgendada)) {
    return normalized;
  }
  const persisted = await loadAgendamentoSnapshot(normalized?.id || fallback?.id, null);
  return normalizeScheduleItem(persisted || normalized, normalized);
}

async function resolveOperationContext({ rawToken = '', lookupId = '', expectedPrefix = '' } = {}) {
  const normalizedToken = normalizePublicOperationToken(rawToken);
  const numericLookupId = Number(String(lookupId || '').replace(/\D/g, '').trim()) || null;
  if (normalizedToken) {
    if (expectedPrefix && !tokenMatchesExpectedPrefix(normalizedToken, expectedPrefix)) {
      return { item: null, normalizedToken, lookupId: numericLookupId, reason: 'wrong_token_type' };
    }
    const foundByToken = await resolveByToken(normalizedToken);
    if (!foundByToken) {
      if (numericLookupId) {
        const foundById = await findOperationItemById(numericLookupId);
        if (foundById) {
          return { item: foundById, normalizedToken, lookupId: numericLookupId, reason: 'resolved_by_id_fallback', tokenMatchedStored: false };
        }
      }
      return { item: null, normalizedToken, lookupId: numericLookupId, reason: 'token_not_found' };
    }
    if (numericLookupId && Number(foundByToken?.id || 0) !== numericLookupId) {
      return { item: null, normalizedToken, lookupId: numericLookupId, foundId: Number(foundByToken?.id || 0) || null, reason: 'id_mismatch' };
    }
    return { item: foundByToken, normalizedToken, lookupId: numericLookupId, reason: 'resolved_by_token', tokenMatchedStored: true };
  }
  const foundById = await findOperationItemById(lookupId);
  if (!foundById) {
    return { item: null, normalizedToken: '', lookupId: numericLookupId, reason: numericLookupId ? 'id_not_found' : 'empty_reference' };
  }
  return { item: foundById, normalizedToken: '', lookupId: numericLookupId, reason: 'resolved_by_id' };
}

function buildPublicTokenLogDetails({ operation, req, rawReference, operationRef, resolution, item = null, reason = null, extra = {} } = {}) {
  return {
    operation,
    route: req?.originalUrl || req?.url || null,
    method: req?.method || null,
    ip: req?.ip || null,
    userAgent: req?.get ? req.get('user-agent') : null,
    tokenRecebido: String(rawReference || '').trim() || null,
    tokenNormalizado: operationRef?.token || resolution?.normalizedToken || null,
    idRecebido: String(operationRef?.id || resolution?.lookupId || '').trim() || null,
    agendamentoEncontrado: item ? Number(item?.id || 0) || null : null,
    statusAtual: item?.status || null,
    motivoBloqueio: reason || resolution?.reason || null,
    ...extra
  };
}

async function logPublicTokenFlow({ operation, req, rawReference, operationRef, resolution, item = null, reason = null, extra = {} } = {}) {
  const details = buildPublicTokenLogDetails({ operation, req, rawReference, operationRef, resolution, item, reason, extra });
  try {
    logTechnicalEvent('public-token-flow', details);
  } catch (error) {
    console.error('[TECH_LOG] Falha ao registrar telemetria pública:', error?.message || error);
  }
  try {
    await auditLog({
      usuarioId: null,
      perfil: 'PUBLICO',
      acao: `TOKEN_${String(operation || '').toUpperCase()}`,
      entidade: 'AGENDAMENTO',
      entidadeId: Number(item?.id || 0) || null,
      detalhes: details,
      ip: req?.ip || null
    });
  } catch (error) {
    console.error('[AUDIT] Falha ao registrar auditoria pública:', error?.message || error);
  }
}

async function logPublicAction({ actor = null, action, item, req, details = null }) {
  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    perfil: actor?.perfil || null,
    acao: action,
    entidade: "AGENDAMENTO",
    entidadeId: Number(item?.id || 0) || null,
    detalhes: details,
    ip: req.ip
  });
}

async function sendScheduleCreatedNotice(item, req) {
  if (!item?.emailTransportadora) {
    return { sent: false, reason: "Não há e-mail da transportadora/fornecedor cadastrado." };
  }

  const normalized = normalizeScheduleItem(item);
  const links = buildLinks(req, normalized);
  const textoDoca = normalized.doca?.codigo || normalized.doca || "A DEFINIR";
  return sendMail({
    to: normalized.emailTransportadora,
    subject: `Solicitação de agendamento recebida ${normalized.protocolo}`,
    text: `Solicitação registrada para ${normalized.dataAgendada || "-"} às ${normalized.horaAgendada || "-"}.
Protocolo: ${normalized.protocolo}
Status atual: ${normalized.status || "PENDENTE_APROVACAO"}
Doca: ${textoDoca}
Token de consulta da transportadora: ${normalized.publicTokenFornecedor}
Consulta do agendamento: ${links.consulta}

O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.`,
    html: `<p>Solicitação registrada para <strong>${normalized.dataAgendada || "-"}</strong> às <strong>${normalized.horaAgendada || "-"}</strong>.</p><p><strong>Protocolo:</strong> ${normalized.protocolo}<br><strong>Status atual:</strong> ${normalized.status || "PENDENTE_APROVACAO"}<br><strong>Doca:</strong> ${textoDoca}<br><strong>Token de consulta da transportadora:</strong> ${normalized.publicTokenFornecedor}</p><p><a href="${links.consulta}">Consultar agendamento</a></p><p>O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.</p>`
  }).then((result) => ({ ...result, to: normalized.emailTransportadora, consulta: links.consulta, tokenConsulta: normalized.publicTokenFornecedor }));
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
  return sendMail({
    to: recipients.join(", "),
    subject: mail.subject,
    text: mail.text,
    html: mail.html
  }).then((result) => ({ ...result, to: recipients.join(", ") }));
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
          observacao: encodeNotaObservacao(nota)
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
  if (!canShareVoucher(item)) return res.status(403).json({ message: "O voucher só fica disponível após a aprovação do agendamento." });
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
  try {
    const actor = getOptionalActor(req);
    const rawReference = req.body?.rawToken || req.body?.token || req.query?.token || req.params.token;
    const operationRef = parsePublicOperationReference(rawReference);
    const lookupId = String(req.body?.lookupId || req.query?.id || operationRef.id || '').trim();
    const resolution = await resolveOperationContext({ rawToken: operationRef.token || req.params.token, lookupId, expectedPrefix: 'CHK' });
    const item = resolution.item ? await ensureOperationScheduleContext(resolution.item) : null;

    if (!item) {
      await logPublicTokenFlow({ operation: 'checkin', req, rawReference, operationRef, resolution, reason: resolution.reason });
      const message = resolution.reason === 'wrong_token_type'
        ? 'Token informado não pertence ao fluxo de check-in.'
        : resolution.reason === 'id_mismatch'
          ? 'O token informado não corresponde ao agendamento selecionado.'
          : 'Token de check-in inválido.';
      return res.status(404).json({ message, reason: resolution.reason });
    }

    if (!["APROVADO", "CHEGOU"].includes(item.status)) {
      await logPublicTokenFlow({ operation: 'checkin', req, rawReference, operationRef, resolution, item, reason: 'status_not_allowed' });
      return res.status(400).json({ message: "Check-in só permitido para agendamentos aprovados." });
    }

    const scheduleAwareItem = await ensureOperationScheduleContext(item);
    const windowInfo = buildCheckinWindow(scheduleAwareItem);
    const requiresManualAuthorization = !!(windowInfo.dateMismatch || windowInfo.timeMismatch);
    const requiresGestorAuthorization = !!windowInfo.tooEarly;
    const overrideRequested = !!(req.body?.overrideDateMismatch || req.body?.overrideTimeMismatch || req.body?.overrideManualAuthorization);

    if (requiresManualAuthorization && !overrideRequested) {
      let gestorNotification = { sent: false, reason: "Notificação ao gestor não necessária.", to: null };
      if (requiresGestorAuthorization) {
        try {
          gestorNotification = await notifyGestorAboutEarlyCheckin(scheduleAwareItem, req, windowInfo);
        } catch (error) {
          gestorNotification = { sent: false, reason: error?.message || 'Falha ao notificar o gestor.', to: null };
          logTechnicalEvent('public-checkin-manager-notification-error', {
            agendamentoId: Number(item?.id || 0) || null,
            token: operationRef.token || req.params.token,
            reason: error?.message || String(error)
          });
        }
      }

      await logPublicAction({
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
      });
      await logPublicTokenFlow({ operation: 'checkin', req, rawReference, operationRef, resolution, item, reason: requiresGestorAuthorization ? 'requires_manager_authorization' : 'outside_window', extra: { gestorNotification } });

      const baseMessage = buildCheckinMismatchMessage(scheduleAwareItem, windowInfo);
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
      await logPublicTokenFlow({ operation: 'checkin', req, rawReference, operationRef, resolution, item, reason: 'override_without_permission' });
      return res.status(403).json({ message: "A liberação manual do check-in fora da janela só pode ser feita por operador, portaria, gestor ou administrador autenticado." });
    }

    const patch = { status: "CHEGOU", checkinEm: item.checkinEm || new Date() };
    let updated;
    try {
      updated = await prisma.agendamento.update({ where: { id: item.id }, data: patch });
    } catch (error) {
      logTechnicalEvent('public-checkin-persistence-fallback', { agendamentoId: item.id, reason: error?.message || String(error) });
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
    await logPublicTokenFlow({ operation: 'checkin', req, rawReference, operationRef, resolution, item: updated, reason: 'success' });

    return res.json({
      ok: true,
      message: requiresManualAuthorization ? "Check-in realizado com liberação manual do operador." : "Check-in realizado com sucesso.",
      agendamento: updated,
      requiresManualAuthorization: false
    });
  } catch (error) {
    logTechnicalEvent('public-checkin-unhandled-error', {
      route: req.originalUrl || req.url,
      token: req.params.token,
      reason: error?.message || String(error)
    });
    console.error('[PUBLIC_CHECKIN] Falha inesperada:', error);
    return res.status(500).json({ message: 'Falha interna ao validar o token de check-in.', detail: error?.message || 'Erro interno do servidor.' });
  }
});

router.post('/checkout/:token', publicAvariaUploadMiddleware, async (req, res) => {
  try {
    const actor = getOptionalActor(req);
    const rawReference = req.body?.rawToken || req.body?.token || req.query?.token || req.params.token;
    const operationRef = parsePublicOperationReference(rawReference);
    const lookupId = String(req.body?.lookupId || req.query?.id || operationRef.id || '').trim();
    const resolution = await resolveOperationContext({ rawToken: operationRef.token || req.params.token, lookupId, expectedPrefix: 'OUT' });
    const item = resolution.item;
    if (!item) {
      await logPublicTokenFlow({ operation: 'checkout', req, rawReference, operationRef, resolution, reason: resolution.reason });
      const message = resolution.reason === 'wrong_token_type'
        ? 'Token informado não pertence ao fluxo de check-out.'
        : resolution.reason === 'id_mismatch'
          ? 'O token informado não corresponde ao agendamento selecionado.'
          : 'Token de check-out inválido.';
      return res.status(404).json({ message, reason: resolution.reason });
    }

    if (String(item.status || '').trim().toUpperCase() === 'CHEGOU') {
      await logPublicTokenFlow({ operation: 'checkout', req, rawReference, operationRef, resolution, item, reason: 'requires_start_unload' });
      return res.status(409).json({
        message: 'O check-out por token/QR só pode ser executado após o início da descarga. Inicie a descarga ou finalize pelo painel interno.',
        requiresStartUnload: true,
        currentStatus: item.status,
        agendamento: normalizeScheduleItem(item)
      });
    }

    if (String(item.status || '').trim().toUpperCase() !== 'EM_DESCARGA') {
      await logPublicTokenFlow({ operation: 'checkout', req, rawReference, operationRef, resolution, item, reason: 'status_not_allowed' });
      return res.status(400).json({ message: 'Check-out só permitido após o início da descarga.' });
    }

    let avaliacaoRecebimento;
    try {
      avaliacaoRecebimento = normalizeCheckoutPayload(req.body || {});
    } catch (err) {
      await logPublicTokenFlow({ operation: 'checkout', req, rawReference, operationRef, resolution, item, reason: 'invalid_checkout_payload', extra: { message: err.message } });
      return res.status(400).json({ message: err.message });
    }

    const files = uploadedAvariaFilesFromReq(req);
    const patch = {
      status: 'FINALIZADO',
      fimDescargaEm: new Date(),
      observacoes: mergeCheckoutObservations(item.observacoes, avaliacaoRecebimento)
    };

    let updated;
    try {
      updated = await prisma.agendamento.update({ where: { id: item.id }, data: patch });
    } catch (error) {
      logTechnicalEvent('public-checkout-persistence-fallback', { agendamentoId: item.id, reason: error?.message || String(error) });
      updated = updateAgendamentoFile(item.id, {
        ...patch,
        fimDescargaEm: new Date().toISOString()
      });
    }

    const refreshed = await loadAgendamentoSnapshot(updated?.id || item?.id, { ...item, ...updated });
    const normalizedUpdated = await ensureOperationScheduleContext(refreshed || { ...item, ...updated }, item);
    const survey = await sendDriverFeedbackRequestEmail({
      agendamento: normalizedUpdated,
      baseUrl: getBaseUrl(req)
    });

    const ocorrenciaRecebimento = await notifyControladoriaAvaria({
      agendamento: normalizedUpdated,
      payload: avaliacaoRecebimento,
      actor,
      files
    }).catch((err) => ({ sent: false, to: controladoriaRecipients().join(', ') || null, reason: err.message || 'Falha ao enviar e-mail de avaria.' }));

    await logPublicAction({
      actor,
      action: 'CHECKOUT_QR',
      item: normalizedUpdated,
      req,
      details: {
        origem: 'qr-code',
        surveySent: !!survey?.sent,
        surveyTo: survey?.to || null,
        feedbackLink: survey?.feedbackLink || null,
        surveyReason: survey?.reason || null,
        avaliacaoRecebimento,
        ocorrenciaRecebimento,
        anexosAvaria: files.map((file) => file.originalname)
      }
    });
    await logPublicTokenFlow({ operation: 'checkout', req, rawReference, operationRef, resolution, item: normalizedUpdated, reason: 'success', extra: { anexosAvaria: files.map((file) => file.originalname) } });

    return res.json({ ok: true, message: 'Check-out realizado com sucesso.', agendamento: normalizedUpdated, avaliacao: survey, avaliacaoRecebimento, ocorrenciaRecebimento });
  } catch (error) {
    logTechnicalEvent('public-checkout-unhandled-error', {
      route: req.originalUrl || req.url,
      token: req.params.token,
      reason: error?.message || String(error)
    });
    console.error('[PUBLIC_CHECKOUT] Falha inesperada:', error);
    return res.status(500).json({ message: 'Falha interna ao validar o token de check-out.', detail: error?.message || 'Erro interno do servidor.' });
  }
});

export default router;
