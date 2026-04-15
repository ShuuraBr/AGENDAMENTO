import { Router } from "express";
import path from "path";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";
import { sendMail } from "../utils/email.js";
import { sendWhatsApp } from "../services/whatsapp.js";
import { calculateTotals, normalizeCpf } from "../utils/agendamento-helpers.js";
import { readAgendamentos, findAgendamentoFile, updateAgendamentoFile, createAgendamentoFile, addDocumentoFile, addNotaFile, readAuditLogs } from "../utils/file-store.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { auditLog } from "../utils/audit.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { fetchAgendamentosRaw } from "../utils/db-fallback.js";
import { canonicalizeNotasSelecionadasComRelatorio, linkRelatorioRowsToAgendamento, unlinkRelatorioRowsFromAgendamento, persistManualPendingNota, removePendingNotasFromRelatorio } from "../utils/relatorio-entradas.js";
import { sendDriverFeedbackRequestEmail } from "../utils/feedback-notifications.js";
import { analyzeNotesForSchedule, enrichAgendamentoWithMonitoring, sendFinanceAwarenessEmail, sendMonthlyNearDueDigestIfNeeded, searchByNumeroNf } from "../utils/nf-monitoring.js";
import { encodeNotaObservacao } from "../utils/nota-metadata.js";
import { createDocumentUpload, createAvariaImageUpload, wrapMulter, AVARIA_IMAGE_MAX_COUNT } from "../utils/upload-policy.js";
import { logTechnicalEvent } from "../utils/telemetry.js";

const router = Router();
router.use(authRequired);

const upload = createDocumentUpload();
const uploadMiddleware = wrapMulter(upload.single("arquivo"));
const avariaUpload = createAvariaImageUpload();
const uploadAvariaMiddleware = wrapMulter(avariaUpload.fields([{ name: "imagensAvaria", maxCount: AVARIA_IMAGE_MAX_COUNT }]));

function parseAuditDetalhes(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function normalizeOccurrenceLog(item = {}) {
  const detalhes = parseAuditDetalhes(item?.detalhes);
  return {
    id: Number(item?.id || 0) || null,
    usuarioId: Number(item?.usuarioId || item?.usuario?.id || 0) || null,
    usuarioNome: item?.usuarioNome || item?.usuario?.nome || null,
    perfil: item?.perfil || item?.usuario?.perfil || null,
    entidade: String(item?.entidade || '').trim(),
    acao: String(item?.acao || '').trim(),
    entidadeId: item?.entidadeId == null ? null : Number(item.entidadeId),
    createdAt: item?.createdAt || null,
    detalhes
  };
}

function getBaseUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function buildPublicLinks(req, item) {
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

function formatDateBR(value) {
  if (!value) return "-";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getUTCFullYear());
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }
  const raw = String(value).trim();
  const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (compact) return `${compact[3]}/${compact[2]}/${compact[1]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const year = String(native.getUTCFullYear());
    const month = String(native.getUTCMonth() + 1).padStart(2, "0");
    const day = String(native.getUTCDate()).padStart(2, "0");
    return `${day}/${month}/${year}`;
  }
  return raw || "-";
}

function formatHourLabel(value) {
  if (!value) return "-";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hh = String(value.getUTCHours()).padStart(2, '0');
    const mm = String(value.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (match) return `${match[1]}:${match[2]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const hh = String(native.getUTCHours()).padStart(2, '0');
    const mm = String(native.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return raw || '-';
}

function parseJanelaCodigo(codigo = '') {
  const match = String(codigo || '').match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  return match ? { horaInicio: match[1], horaFim: match[2] || '' } : { horaInicio: '', horaFim: '' };
}


function pickScheduleDateCandidate(source = {}) {
  return source?.dataAgendada ?? source?.data_agendada ?? source?.dataProgramada ?? source?.data_programada ?? '';
}

function pickScheduleTimeCandidate(source = {}) {
  return source?.horaAgendada ?? source?.hora_agendada ?? source?.horaProgramada ?? source?.hora_programada ?? '';
}

function resolveScheduleValues(item = {}, fallback = {}) {
  const dataAgendada = normalizeScheduleDateValue(pickScheduleDateCandidate(item) || pickScheduleDateCandidate(fallback));
  const janelaCodigo = item?.janela?.codigo || fallback?.janela?.codigo || item?.janela || fallback?.janela || '';
  const derivedHour = parseJanelaCodigo(janelaCodigo).horaInicio;
  const horaAgendada = normalizeScheduleTimeValue(pickScheduleTimeCandidate(item) || pickScheduleTimeCandidate(fallback) || derivedHour || '');
  return { dataAgendada, horaAgendada };
}



function buildRecebimentoObservacao(payload = {}) {
  const parts = [`Descarga: ${payload.comoFoiDescarga || 'BOA'}`];
  if (payload.houveAvaria) {
    parts.push(`Avaria: SIM`);
    parts.push(`Item: ${payload.itemAvaria}`);
    parts.push(`Quantidade: ${payload.quantidadeAvaria}`);
    parts.push(`Detalhe: ${payload.observacaoAvaria}`);
  } else {
    parts.push('Avaria: NÃO');
  }
  if (payload.observacaoAssistente) parts.push(`Obs. assistente: ${payload.observacaoAssistente}`);
  return `[FINALIZAÇÃO] ${parts.join(' | ')}`;
}



function daysUntilDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const target = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

async function resolveCreateUserMap(agendamentoIds = []) {
  const ids = [...new Set((Array.isArray(agendamentoIds) ? agendamentoIds : []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return new Map();

  try {
    const logs = await prisma.logAuditoria.findMany({
      where: {
        entidade: 'AGENDAMENTO',
        acao: 'CREATE',
        entidadeId: { in: ids }
      },
      include: { usuario: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });

    const map = new Map();
    for (const log of logs || []) {
      const key = Number(log.entidadeId || 0);
      if (!key || map.has(key)) continue;
      const nome = log.usuario?.nome || log.usuarioNome || null;
      map.set(key, nome || null);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function countScheduledNotesForDate(dataAgendada = '') {
  const date = String(dataAgendada || '').trim();
  if (!date) return { totalAgendamentosNoDia: 0, totalNotasNoDia: 0 };

  try {
    const items = await prisma.agendamento.findMany({
      where: { dataAgendada: date },
      include: { notasFiscais: true }
    });
    const totalNotasNoDia = (items || []).reduce((acc, item) => {
      const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais.length : 0;
      return acc + Number(item?.quantidadeNotas || notas || 0);
    }, 0);
    return { totalAgendamentosNoDia: Number(items?.length || 0), totalNotasNoDia };
  } catch {
    const items = readAgendamentos().filter((item) => String(item?.dataAgendada || '') === date);
    const totalNotasNoDia = items.reduce((acc, item) => {
      const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais.length : 0;
      return acc + Number(item?.quantidadeNotas || notas || 0);
    }, 0);
    return { totalAgendamentosNoDia: Number(items.length || 0), totalNotasNoDia };
  }
}

async function loadAgendamentosForConsulta({ numeroNf = '', dataAgendada = '' } = {}) {
  const nfDigits = String(numeroNf || '').replace(/\D/g, '');
  const targetDate = String(dataAgendada || '').trim();
  const matches = (item = {}) => {
    if (targetDate && String(item?.dataAgendada || '') !== targetDate) return false;
    if (!nfDigits) return true;
    const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais : Array.isArray(item?.notas) ? item.notas : [];
    return notas.some((nota) => String(nota?.numeroNf || '').replace(/\D/g, '').includes(nfDigits));
  };

  try {
    const items = await prisma.agendamento.findMany({
      include: { notasFiscais: true, documentos: true, doca: true, janela: true },
      orderBy: { id: 'desc' }
    });
    return (items || []).filter(matches);
  } catch {
    return readAgendamentos().filter(matches);
  }
}


function buildScheduleIntro(item) {
  const normalized = normalizeScheduleItem(item);
  return `O agendamento foi efetuado para o dia ${formatDateBR(normalized?.dataAgendada)}, às ${formatHourLabel(normalized?.horaAgendada)}. Solicitamos chegada com 10 minutos de antecedência.`;
}

function normalizeScheduleDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCFullYear())}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    return `${String(native.getUTCFullYear())}-${String(native.getUTCMonth() + 1).padStart(2, '0')}-${String(native.getUTCDate()).padStart(2, '0')}`;
  }
  return raw;
}

function normalizeScheduleTimeValue(value) {
  if (!value) return '';
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

function deriveHourFromJanela(item = {}) {
  const janelaCodigo = String(item?.janela?.codigo || item?.janela || item?.janelaCodigo || '').trim();
  const match = janelaCodigo.match(/(\d{2}:\d{2})/);
  return match?.[1] || '';
}

function normalizeScheduleItem(item = {}, fallback = null) {
  const resolved = resolveScheduleValues(item, fallback || {});
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
          ? (() => { try { return JSON.parse(entry); } catch { return { produto: entry, quantidade: 0 }; } })()
          : entry;
        return {
          produto: String(parsedEntry?.produto || parsedEntry?.item || '').trim(),
          quantidade: Number(parsedEntry?.quantidade || parsedEntry?.qtd || 0) || 0
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
  const quantity = Number(fallbackQuantity || 0) || 0;
  return item || quantity ? [{ produto: item, quantidade: quantity }] : [];
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
  return items.map((entry) => `- ${entry.produto || '-'} | Quantidade: ${entry.quantidade || '-'}`).join('\n');
}

function buildAvariaItemsHtml(avarias = []) {
  const items = Array.isArray(avarias) ? avarias : [];
  if (!items.length) return '<li>Nenhum produto informado.</li>';
  return items.map((entry) => `<li><strong>${entry.produto || '-'}</strong> | Quantidade: ${entry.quantidade || '-'}</li>`).join('');
}

function normalizeFinalizacaoRecebimento(body = {}) {
  const avarias = normalizeAvariaItems(
    body?.avarias,
    body?.itemAvaria || body?.item,
    body?.quantidadeAvaria || body?.quantidade
  );
  const payload = {
    comoFoiDescarga: String(body?.comoFoiDescarga || body?.descargaConcluida || 'BOA').trim().toUpperCase() || 'BOA',
    houveAvaria: parseBooleanLike(body?.houveAvaria ?? body?.teveOcorrencia),
    tipoAvaria: normalizeAvariaType(body?.tipoAvaria || body?.tipoOcorrencia),
    origemRecebimento: normalizeRecebimentoOrigin(body?.origemRecebimento || body?.localRecebimento || body?.recebidoEm),
    avarias,
    itemAvaria: String(avarias?.[0]?.produto || body?.itemAvaria || body?.item || '').trim(),
    quantidadeAvaria: Number(avarias?.[0]?.quantidade || body?.quantidadeAvaria || body?.quantidade || 0) || 0,
    observacaoAvaria: String(body?.observacaoAvaria || body?.descricaoOcorrencia || '').trim(),
    observacaoAssistente: String(body?.observacaoAssistente || '').trim(),
    motoristaTranquilo: String(body?.motoristaTranquilo || '').trim(),
    cargaBatida: String(body?.cargaBatida || '').trim()
  };
  if (payload.houveAvaria) {
    const hasInvalidItems = !payload.avarias.length || payload.avarias.some((entry) => !entry.produto || !(Number(entry.quantidade) > 0));
    if (!payload.tipoAvaria || !payload.origemRecebimento || hasInvalidItems) {
      throw new Error('Preencha o tipo da avaria, a origem do recebimento e todos os produtos com quantidade antes de finalizar o agendamento.');
    }
  }
  return payload;
}

function mergeOperationalObservations(existing = '', payload = {}) {
  const parts = [];
  if (payload?.comoFoiDescarga) parts.push(`Descarga: ${payload.comoFoiDescarga}`);
  if (payload?.observacaoAssistente) parts.push(`Assistente: ${payload.observacaoAssistente}`);
  if (payload?.motoristaTranquilo) parts.push(`Motorista tranquilo: ${payload.motoristaTranquilo}`);
  if (payload?.cargaBatida) parts.push(`Carga batida: ${payload.cargaBatida}`);
  if (payload?.houveAvaria) {
    parts.push(`Tipo avaria: ${payload.tipoAvaria || '-'}`);
    parts.push(`Origem recebimento: ${payload.origemRecebimento || '-'}`);
    const avarias = Array.isArray(payload?.avarias) ? payload.avarias : [];
    parts.push(`Produtos: ${avarias.map((entry) => `${entry.produto || '-'} (${entry.quantidade || '-'})`).join(', ') || '-'}`);
    if (payload?.observacaoAvaria) parts.push(`Obs. avaria: ${payload.observacaoAvaria}`);
  }
  return [String(existing || '').trim(), parts.join(' | ')].filter(Boolean).join(' | ');
}

function uploadedAvariaFilesFromReq(req) {
  const raw = req?.files;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (Array.isArray(raw.imagensAvaria)) return raw.imagensAvaria.filter(Boolean);
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

const MANDATORY_VOUCHER_NOTICE_TEXT = 'Obrigatório: Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento. O motorista deve estar utilizando EPI (botina, cinta lombar, luvas e, se necessário, capacete) e acompanhado de um auxiliar para descarregar.';
const MANDATORY_VOUCHER_NOTICE_HTML = '<strong>Obrigatório:</strong> Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento. O motorista deve estar utilizando EPI (botina, cinta lombar, luvas e, se necessário, capacete) e acompanhado de um auxiliar para descarregar.';

function fiscalRecipient() {
  return String(
    process.env.FISCAL_EMAIL
    || process.env.EMAIL_FISCAL
    || process.env.SETOR_FISCAL_EMAIL
    || process.env.FISCAL_SETOR_EMAIL
    || process.env.FINANCEIRO_EMAIL
    || process.env.EMAIL_FINANCEIRO
    || ''
  ).trim();
}

function fiscalCcRecipients() {
  const raw = [
    process.env.FISCAL_CC_EMAILS,
    process.env.FISCAL_EMAIL_CC,
    process.env.EMAIL_FISCAL_CC,
    process.env.SETOR_FISCAL_CC,
    process.env.SETOR_FISCAL_CC_EMAILS
  ].filter(Boolean).join(',');

  const emails = raw
    .split(/[;,]/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return emails.length ? [...new Set(emails)].join(', ') : '';
}

function parseEmailList(...values) {
  const emails = values
    .flatMap((value) => String(value || '').split(/[;,]/))
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  return [...new Set(emails)];
}

function occurrenceRecipients() {
  return parseEmailList(
    process.env.COMPRADORES_EMAILS,
    process.env.EMAILS_COMPRADORES,
    process.env.COORDENADORES_EMAILS,
    process.env.EMAILS_COORDENADORES,
    process.env.OCORRENCIA_EMAILS,
    process.env.URGENCIA_AGENDAMENTO_EMAILS
  );
}


function renderNotasTableHtml(notas = []) {
  const rows = (Array.isArray(notas) ? notas : []).map((nota) => `
    <tr>
      <td style="border:1px solid #d8dee9;padding:8px;">${String(nota?.numeroNf || '-')}</td>
      <td style="border:1px solid #d8dee9;padding:8px;">${String(nota?.serie || '-')}</td>
      <td style="border:1px solid #d8dee9;padding:8px;">${String(nota?.destino || nota?.empresa || '-')}</td>
      <td style="border:1px solid #d8dee9;padding:8px;text-align:right;">${Number(nota?.volumes || 0).toFixed(3)}</td>
      <td style="border:1px solid #d8dee9;padding:8px;text-align:right;">${Number(nota?.peso || 0).toFixed(3)}</td>
      <td style="border:1px solid #d8dee9;padding:8px;text-align:right;">${Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0)}</td>
    </tr>
  `).join('');

  return `
    <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;">
      <thead>
        <tr style="background:#f3f6fa;">
          <th style="border:1px solid #d8dee9;padding:8px;text-align:left;">NF</th>
          <th style="border:1px solid #d8dee9;padding:8px;text-align:left;">Série</th>
          <th style="border:1px solid #d8dee9;padding:8px;text-align:left;">Destino</th>
          <th style="border:1px solid #d8dee9;padding:8px;text-align:right;">Volumes</th>
          <th style="border:1px solid #d8dee9;padding:8px;text-align:right;">Peso</th>
          <th style="border:1px solid #d8dee9;padding:8px;text-align:right;">Itens</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildOccurrenceMail({ transportadora = '', fornecedor = '', notas = [] } = {}) {
  const subject = `Urgente: transportadora negou agendamento - ${transportadora || fornecedor || 'sem identificação'}`;
  const text = [
    `Urgente: após contato com a transportadora "${transportadora || fornecedor || '-'}" para o agendamento das notas abaixo, a mesma negou agendamento.`,
    '',
    ...(Array.isArray(notas) ? notas : []).map((nota) => `NF ${nota?.numeroNf || '-'} | Série ${nota?.serie || '-'} | Destino ${nota?.destino || nota?.empresa || '-'} | Vol ${Number(nota?.volumes || 0).toFixed(3)} | Peso ${Number(nota?.peso || 0).toFixed(3)} | Itens ${Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0)}`)
  ].join('\n');
  const html = `
    <p><strong>Urgente:</strong> após contato com a transportadora "${transportadora || fornecedor || '-'}" para o agendamento das notas abaixo, a mesma negou agendamento.</p>
    <p><strong>Fornecedor:</strong> ${fornecedor || '-'}<br><strong>Transportadora:</strong> ${transportadora || '-'}</p>
    ${renderNotasTableHtml(notas)}
  `;
  return { subject, text, html };
}

function buildManualNotaFiscalMail({ fornecedor = '', nota = {}, actor = null } = {}) {
  const operador = String(actor?.nome || actor?.name || actor?.email || actor?.sub || 'Não identificado').trim();
  const numeroNf = String(nota?.numeroNf || '').trim() || '-';
  const serie = String(nota?.serie || '').trim() || '-';
  const volumes = Number(nota?.volumes || 0);
  const peso = Number(nota?.peso || 0);
  const destino = String(nota?.destino || '').trim() || '-';
  return {
    subject: `Alerta fiscal: NF sem pré-lançamento (${numeroNf}${serie !== '-' ? ` / ${serie}` : ''})`,
    text: [
      'Foi inserida manualmente uma nota fiscal que não consta no relatório terceirizado (sem pré-lançamento).',
      '',
      `Fornecedor: ${fornecedor || '-'}`,
      `NF: ${numeroNf}`,
      `Série: ${serie}`,
      `Qtd. volumes: ${volumes}`,
      `Peso: ${peso}`,
      `Destino: ${destino}`,
      `Operador responsável: ${operador}`
    ].join('\n'),
    html: `
      <p>Foi inserida manualmente uma nota fiscal que <strong>não consta no relatório terceirizado</strong> (sem pré-lançamento).</p>
      <p>
        <strong>Fornecedor:</strong> ${fornecedor || '-'}<br>
        <strong>NF:</strong> ${numeroNf}<br>
        <strong>Série:</strong> ${serie}<br>
        <strong>Qtd. volumes:</strong> ${volumes}<br>
        <strong>Peso:</strong> ${peso}<br>
        <strong>Destino:</strong> ${destino}<br>
        <strong>Operador responsável:</strong> ${operador}
      </p>
    `
  };
}

async function sendFiscalMissingPrelaunchEmail({ fornecedor = '', nota = {}, actor = null } = {}) {
  const to = fiscalRecipient();
  if (!to) return { sent: false, reason: 'E-mail do fiscal não configurado.' };
  const cc = fiscalCcRecipients();
  const mail = buildManualNotaFiscalMail({ fornecedor, nota, actor });
  return sendMail({ to, cc: cc || undefined, subject: mail.subject, text: mail.text, html: mail.html });
}

async function dispatchDriverFeedbackSurvey(item, req, actor = req.user) {
  const normalized = normalizeScheduleItem(item);
  const result = await sendDriverFeedbackRequestEmail({
    agendamento: normalized,
    baseUrl: getBaseUrl(req)
  });

  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    perfil: actor?.perfil || null,
    acao: 'ENVIAR_AVALIACAO',
    entidade: 'AGENDAMENTO',
    entidadeId: normalized.id,
    detalhes: {
      sent: !!result?.sent,
      to: result?.to || null,
      feedbackLink: result?.feedbackLink || null,
      reason: result?.reason || null,
      dataAgendada: normalized.dataAgendada || null,
      horaAgendada: normalized.horaAgendada || null
    },
    ip: req.ip
  });

  return result;
}

async function full(id) {
  try {
    return await prisma.agendamento.findUnique({ where: { id: Number(id) }, include: { notasFiscais: true, documentos: true, doca: true, janela: true } });
  } catch {
    return findAgendamentoFile(id);
  }
}

async function mustExist(id) {
  try { return await prisma.agendamento.findUnique({ where: { id: Number(id) } }); } catch { return findAgendamentoFile(id); }
}

async function notificationSummary(agendamentoId) {
  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: "AGENDAMENTO", entidadeId: Number(agendamentoId) },
    orderBy: { createdAt: "desc" }
  });

  const findLog = (acao, predicate = () => true) => logs.find((log) => {
    if (log.acao !== acao) return false;
    try {
      const detalhes = log.detalhes ? JSON.parse(log.detalhes) : {};
      return predicate(detalhes || {});
    } catch {
      return false;
    }
  });

  return {
    voucherMotorista: !!findLog("ENVIAR_INFORMACOES", (d) => Array.isArray(d.targets) && d.targets.includes("motorista")),
    voucherTransportadoraFornecedor: !!findLog("ENVIAR_INFORMACOES", (d) => Array.isArray(d.targets) && d.targets.includes("transportadora/fornecedor")),
    confirmacaoTransportadoraFornecedor: !!findLog("ENVIAR_CONFIRMACAO", (d) => Array.isArray(d.targets) && d.targets.includes("transportadora/fornecedor"))
  };
}

const EMPTY_NOTIFICATIONS = { voucherMotorista: false, voucherTransportadoraFornecedor: false, confirmacaoTransportadoraFornecedor: false };

const VOUCHER_ALLOWED_STATUSES = new Set(["APROVADO", "CHEGOU", "EM_DESCARGA", "FINALIZADO"]);

function canShareVoucher(itemOrStatus) {
  const status = typeof itemOrStatus === "string" ? itemOrStatus : itemOrStatus?.status;
  return VOUCHER_ALLOWED_STATUSES.has(String(status || "").trim().toUpperCase());
}

async function enrichResponseItem(item) {
  if (!item) return item;
  try { return await enrichAgendamentoWithMonitoring(item); } catch { return item; }
}

async function buildAwarenessAnalysisFromPayload(base = {}, payload = {}) {
  const notas = Array.isArray(base?.notasFiscais) ? base.notasFiscais : Array.isArray(payload?.notasFiscais) ? payload.notasFiscais : [];
  const fornecedor = payload?.fornecedor || base?.fornecedor || '';
  const dataAgendada = payload?.dataAgendada || base?.dataAgendada || '';
  return analyzeNotesForSchedule({ notas, fornecedor, dataAgendada });
}

async function sendFinanceAwarenessIfNeeded({ agendamento, payload, actor }) {
  const analysis = await buildAwarenessAnalysisFromPayload(agendamento, payload);
  if (!analysis?.requiresAwareness || !payload?.confirmarCienciaVencimento) return { sent: false, reason: 'Ciência não necessária ou não confirmada.' };
  return sendFinanceAwarenessEmail({ agendamento, analysis, actor });
}

async function safeNotificationSummary(agendamentoId) {
  try {
    return await notificationSummary(agendamentoId);
  } catch {
    return { ...EMPTY_NOTIFICATIONS };
  }
}

async function createAgendamentoInDatabase(payload) {
  const notas = Array.isArray(payload.notasFiscais) ? payload.notasFiscais : [];
  const protocol = generateProtocol();
  const publicTokenMotorista = generatePublicToken("MOT", payload.cpfMotorista);
  const publicTokenFornecedor = generatePublicToken("FOR", payload.fornecedor);
  const checkinToken = generatePublicToken("CHK", payload.cpfMotorista || payload.placa);
  const checkoutToken = generatePublicToken("OUT", payload.cpfMotorista || payload.placa);

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.agendamento.create({
      data: {
        protocolo: protocol,
        publicTokenMotorista,
        publicTokenFornecedor,
        checkinToken,
        checkoutToken,
        fornecedor: payload.fornecedor,
        transportadora: payload.transportadora,
        motorista: payload.motorista,
        cpfMotorista: payload.cpfMotorista || "",
        telefoneMotorista: payload.telefoneMotorista || "",
        emailMotorista: payload.emailMotorista || "",
        emailTransportadora: payload.emailTransportadora || "",
        placa: payload.placa,
        docaId: Number(payload.docaId),
        janelaId: Number(payload.janelaId),
        dataAgendada: payload.dataAgendada,
        horaAgendada: payload.horaAgendada,
        quantidadeNotas: Number(payload.quantidadeNotas || 0),
        quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
        pesoTotalKg: Number(payload.pesoTotalKg || 0),
        valorTotalNf: Number(payload.valorTotalNf || 0),
        status: "PENDENTE_APROVACAO",
        observacoes: payload.observacoes || ""
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

  return full(item);
}

async function sendScheduleCreatedNotice(item, req, actor = req.user) {
  const normalizedItem = normalizeScheduleItem(item);
  if (!normalizedItem?.emailTransportadora) {
    return { sent: false, reason: "Não há e-mail da transportadora/fornecedor cadastrado." };
  }

  const links = buildPublicLinks(req, normalizedItem);
  const textoDoca = normalizedItem.doca?.codigo || normalizedItem.doca || "A DEFINIR";
  const scheduleIntro = buildScheduleIntro(normalizedItem);
  const sent = await sendMail({
    to: normalizedItem.emailTransportadora,
    subject: `Solicitação de agendamento recebida ${normalizedItem.protocolo}`,
    text: `${scheduleIntro}
Protocolo: ${normalizedItem.protocolo}
Status atual: ${normalizedItem.status || "PENDENTE_APROVACAO"}
Doca: ${textoDoca}
Token de consulta da transportadora: ${normalizedItem.publicTokenFornecedor}
Consulta do agendamento: ${links.consulta}

O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.`,
    html: `<p>${scheduleIntro}</p><p><strong>Protocolo:</strong> ${normalizedItem.protocolo}</p><p><strong>Status atual:</strong> ${normalizedItem.status || "PENDENTE_APROVACAO"}</p><p><strong>Doca:</strong> ${textoDoca}</p><p><strong>Token de consulta da transportadora:</strong> ${normalizedItem.publicTokenFornecedor}</p><p><a href="${links.consulta}">Consultar agendamento</a></p><p>O voucher operacional e o QR Code do motorista serão enviados somente após a aprovação do agendamento.</p>`
  });

  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    usuarioNome: actor?.nome || actor?.name || null,
    perfil: actor?.perfil || null,
    acao: "ENVIAR_AVISO_CRIACAO",
    entidade: "AGENDAMENTO",
    entidadeId: normalizedItem.id,
    detalhes: { to: normalizedItem.emailTransportadora, sent: !!sent?.sent, consulta: links.consulta },
    ip: req.ip
  });

  return { ...sent, to: normalizedItem.emailTransportadora, consulta: links.consulta, tokenConsulta: normalizedItem.publicTokenFornecedor };
}

async function sendApprovalNotifications(item, req) {
  const normalizedItem = normalizeScheduleItem(item);
  if (!canShareVoucher(normalizedItem)) {
    throw new Error("Voucher e QR Code só podem ser enviados após a aprovação do agendamento.");
  }
  const links = buildPublicLinks(req, normalizedItem);
  const pdf = await generateVoucherPdf(normalizedItem, { baseUrl: getBaseUrl(req) });
  const results = [];
  const targets = [];
  const scheduleIntro = buildScheduleIntro(normalizedItem);

  const commonText = [
    scheduleIntro,
    `Data: ${formatDateBR(normalizedItem?.dataAgendada)}`,
    `Hora: ${formatHourLabel(normalizedItem?.horaAgendada)}`,
    `Protocolo: ${normalizedItem.protocolo}`,
    `Consulta do fornecedor/transportadora: ${links.consulta}`,
    `Acompanhamento do motorista: ${links.motorista}`,
    `Token do motorista: ${normalizedItem.publicTokenMotorista}`,
    `Voucher PDF: ${links.voucher}`,
    `Check-in: ${links.checkin}`,
    `Check-out: ${links.checkout}`,
    '',
    MANDATORY_VOUCHER_NOTICE_TEXT
  ].join("\n");

  const commonHtml = `
    <p>${scheduleIntro}</p>
    <p><strong>Protocolo:</strong> ${normalizedItem.protocolo}</p>
    <p><strong>Data:</strong> ${formatDateBR(normalizedItem?.dataAgendada)}</p>
    <p><strong>Hora:</strong> ${formatHourLabel(normalizedItem?.horaAgendada)}</p>
    <p><a href="${links.consulta}">Consulta da transportadora/fornecedor</a></p>
    <p><a href="${links.motorista}">Acompanhamento do motorista</a></p>
    <p><strong>Token do motorista:</strong> ${normalizedItem.publicTokenMotorista}</p>
    <p><a href="${links.voucher}">Voucher em PDF</a></p>
    <p><a href="${links.checkin}">Check-in</a></p>
    <p><a href="${links.checkout}">Check-out</a></p>
    <p>${MANDATORY_VOUCHER_NOTICE_HTML}</p>
  `;

  if (item.emailMotorista) {
    const sent = await sendMail({
      to: normalizedItem.emailMotorista,
      subject: `Voucher do agendamento ${normalizedItem.protocolo}`,
      text: commonText,
      html: `<p>Olá, motorista.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ tipo: "motorista", to: normalizedItem.emailMotorista, ...sent });
    if (sent.sent) targets.push("motorista");
  }

  if (normalizedItem.emailTransportadora) {
    const sent = await sendMail({
      to: normalizedItem.emailTransportadora,
      subject: `Confirmação do agendamento ${normalizedItem.protocolo}`,
      text: commonText,
      html: `<p>Olá, transportadora/fornecedor.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ tipo: "transportadora/fornecedor", to: normalizedItem.emailTransportadora, ...sent });
    if (sent.sent) targets.push("transportadora/fornecedor");
  }

  if (normalizedItem.telefoneMotorista) {
    const sentWhats = await sendWhatsApp({ to: normalizedItem.telefoneMotorista, message: commonText });
    results.push({ tipo: "whatsapp-motorista", to: normalizedItem.telefoneMotorista, ...sentWhats });
  }

  if (targets.length) {
    await auditLog({
      usuarioId: req.user.sub,
      usuarioNome: req.user.nome || req.user.name || null,
      perfil: req.user.perfil,
      acao: "ENVIAR_INFORMACOES",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { targets },
      ip: req.ip
    });

    if (targets.includes("transportadora/fornecedor")) {
      await auditLog({
        usuarioId: req.user.sub,
        perfil: req.user.perfil,
        acao: "ENVIAR_CONFIRMACAO",
        entidade: "AGENDAMENTO",
        entidadeId: item.id,
        detalhes: { targets: ["transportadora/fornecedor"] },
        ip: req.ip
      });
    }
  }

  return { results, links };
}

async function listPendingManualAuthorizationRequests() {
  let requestLogs = [];
  let authLogs = [];
  try {
    requestLogs = await prisma.logAuditoria.findMany({
      where: { entidade: 'AGENDAMENTO', acao: 'SOLICITAR_AUTORIZACAO_CHECKIN_ANTECIPADO' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    authLogs = await prisma.logAuditoria.findMany({
      where: { entidade: 'AGENDAMENTO', acao: 'AUTORIZAR_CHECKIN_FORA_JANELA' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
  } catch {
    const logs = readAuditLogs().map(normalizeOccurrenceLog);
    requestLogs = logs.filter((item) => item?.entidade === 'AGENDAMENTO' && item?.acao === 'SOLICITAR_AUTORIZACAO_CHECKIN_ANTECIPADO');
    authLogs = logs.filter((item) => item?.entidade === 'AGENDAMENTO' && item?.acao === 'AUTORIZAR_CHECKIN_FORA_JANELA');
  }

  const latestAuthById = new Map();
  for (const log of authLogs || []) {
    const key = Number(log?.entidadeId || 0);
    if (!key || latestAuthById.has(key)) continue;
    latestAuthById.set(key, String(log?.createdAt || ''));
  }

  const pending = [];
  const seen = new Set();
  for (const log of requestLogs || []) {
    const agendamentoId = Number(log?.entidadeId || 0);
    if (!agendamentoId || seen.has(agendamentoId)) continue;
    seen.add(agendamentoId);
    const latestAuth = latestAuthById.get(agendamentoId);
    const requestAt = String(log?.createdAt || '');
    if (latestAuth && latestAuth >= requestAt) continue;
    const agendamento = await full(agendamentoId);
    if (!agendamento) continue;
    const normalized = normalizeScheduleItem(agendamento);
    if (String(normalized?.status || '').toUpperCase() !== 'APROVADO') continue;
    const detalhes = parseAuditDetalhes(log?.detalhes);
    pending.push({
      requestId: `${agendamentoId}:${requestAt}`,
      requestedAt: requestAt,
      agendamentoId,
      agendamento: normalized,
      detalhes: detalhes || null
    });
  }
  return pending.sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || '')));
}

router.get('/autorizacoes-pendentes', requirePermission('agendamentos.checkin'), async (req, res) => {
  try {
    const items = await listPendingManualAuthorizationRequests();
    res.json(items);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post('/:id(\\d+)/autorizar-checkin-manual', requirePermission('agendamentos.checkin'), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error('Agendamento não encontrado.');
    if (String(found.status || '').toUpperCase() === 'CHEGOU') {
      return res.json({ ok: true, message: 'Check-in já autorizado anteriormente.', agendamento: normalizeScheduleItem(found) });
    }
    if (String(found.status || '').toUpperCase() !== 'APROVADO') throw new Error('Somente agendamentos aprovados podem receber autorização manual de check-in.');
    const item = await transition(req.params.id, 'CHEGOU', { checkinEm: found.checkinEm || new Date() }, req);
    await auditLog({
      usuarioId: req.user.sub,
      usuarioNome: req.user.nome || req.user.name || null,
      perfil: req.user.perfil,
      acao: 'AUTORIZAR_CHECKIN_FORA_JANELA',
      entidade: 'AGENDAMENTO',
      entidadeId: item.id,
      detalhes: { origem: 'modal-gestor', motivo: String(req.body?.motivo || 'Autorização manual do gestor/admin.').trim() },
      ip: req.ip
    });
    res.json({ ok: true, message: 'Check-in autorizado manualmente com sucesso.', agendamento: normalizeScheduleItem(await full(item.id), found) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/", requirePermission("agendamentos.view"), async (req, res) => {
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
    const items = await prisma.agendamento.findMany({
      where,
      include: { notasFiscais: true, documentos: true, doca: true, janela: true },
      orderBy: { id: "desc" }
    });
    const payload = await Promise.all(items.map(async (i) => enrichResponseItem({ ...calculateTotals(i.notasFiscais || [], i), ...i, semaforo: trafficColor(i.status), notificacoes: await safeNotificationSummary(i.id) })));
    return res.json(payload);
  } catch {
    try {
      const items = await fetchAgendamentosRaw(q);
      return res.json(await Promise.all(items.map((i) => enrichResponseItem({ ...i, semaforo: trafficColor(i.status), notificacoes: { ...EMPTY_NOTIFICATIONS } }))));
    } catch {}
    const items = readAgendamentos().filter((i) => (!q.status || i.status===String(q.status)) && (!q.fornecedor || String(i.fornecedor||'').toLowerCase().includes(String(q.fornecedor).toLowerCase())) && (!q.transportadora || String(i.transportadora||'').toLowerCase().includes(String(q.transportadora).toLowerCase())) && (!q.motorista || String(i.motorista||'').toLowerCase().includes(String(q.motorista).toLowerCase())) && (!q.placa || String(i.placa||'').toLowerCase().includes(String(q.placa).toLowerCase())) && (!q.dataAgendada || String(i.dataAgendada)===String(q.dataAgendada)));
    return res.json(await Promise.all(items.map((i) => enrichResponseItem({ ...i, semaforo: trafficColor(i.status), notificacoes: { ...EMPTY_NOTIFICATIONS } }))));
  }
});

router.get("/consulta-nf", requirePermission("agendamentos.consulta_nf"), async (req, res) => {
  try {
    const numeroNf = String(req.query?.numeroNf || req.query?.nf || '').trim();
    const dataAgendada = String(req.query?.dataAgendada || req.query?.data || '').trim();
    if (!numeroNf && !dataAgendada) {
      return res.status(400).json({ message: 'Informe o número da NF, a data da consulta, ou ambos.' });
    }

    const modoConsulta = numeroNf && dataAgendada ? 'NF_DATA' : numeroNf ? 'NF' : 'DATA';
    const result = numeroNf ? await searchByNumeroNf(numeroNf) : { relatorio: [], agendamentos: [] };
    const baseAgendamentos = modoConsulta === 'DATA'
      ? await loadAgendamentosForConsulta({ dataAgendada })
      : modoConsulta === 'NF_DATA'
        ? (result.agendamentos || []).filter((item) => String(item?.dataAgendada || '') === dataAgendada)
        : (result.agendamentos || []);

    const agendamentoIds = baseAgendamentos.map((item) => item?.id);
    const createUserMap = await resolveCreateUserMap(agendamentoIds);
    const agendamentos = await Promise.all(baseAgendamentos.map(async (item) => {
      const enriched = await enrichResponseItem(item);
      return {
        ...enriched,
        agendada: true,
        usuarioAgendamento: createUserMap.get(Number(enriched?.id || 0)) || null,
        diasParaAgendamento: daysUntilDate(enriched?.dataAgendada)
      };
    }));
    const resumoDia = dataAgendada ? await countScheduledNotesForDate(dataAgendada) : { totalAgendamentosNoDia: 0, totalNotasNoDia: 0 };
    const agendamentosNoDia = dataAgendada ? agendamentos.filter((item) => String(item?.dataAgendada || '') === dataAgendada) : agendamentos;
    return res.json({
      modoConsulta,
      numeroNf: numeroNf || null,
      dataAgendada: dataAgendada || null,
      encontrada: (result.relatorio || []).length > 0 || agendamentos.length > 0,
      resumo: {
        agendada: agendamentos.length > 0,
        totalOcorrenciasRelatorio: Number((result.relatorio || []).length || 0),
        totalAgendamentosEncontrados: Number(agendamentos.length || 0),
        totalAgendamentosNoDia: Number(resumoDia.totalAgendamentosNoDia || 0),
        totalNotasNoDia: Number(resumoDia.totalNotasNoDia || 0),
        totalAgendamentosDestaNfNoDia: Number(agendamentosNoDia.length || 0),
        totalAgendamentosDaConsulta: Number(agendamentos.length || 0)
      },
      relatorio: result.relatorio || [],
      agendamentos
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

router.post("/analise-vencimento", requirePermission("agendamentos.create"), async (req, res) => {
  try {
    const payload = req.body || {};
    const analysis = await analyzeNotesForSchedule({
      fornecedor: payload.fornecedor || '',
      dataAgendada: payload.dataAgendada || '',
      notas: Array.isArray(payload.notasFiscais) ? payload.notasFiscais : []
    });
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id(\\d+)/analise-vencimento", requirePermission("agendamentos.reschedule"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error('Agendamento não encontrado.');
    const merged = {
      ...found,
      ...req.body,
      notasFiscais: Array.isArray(found.notasFiscais) ? found.notasFiscais : []
    };
    const analysis = await buildAwarenessAnalysisFromPayload(found, merged);
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/notas/manual-alerta", requirePermission("agendamentos.notas"), async (req, res) => {
  try {
    const fornecedor = String(req.body?.fornecedor || '').trim();
    const nota = {
      numeroNf: String(req.body?.numeroNf || '').trim(),
      serie: String(req.body?.serie || '').trim(),
      volumes: Number(req.body?.volumes || 0),
      peso: Number(req.body?.peso || 0),
      destino: String(req.body?.destino || '').trim(),
      observacao: String(req.body?.observacao || '').trim() || 'NF inserida manualmente - sem pré-lançamento',
      origemManual: true,
      inseridaManual: true,
      preLancamentoPendente: true,
      disponivelNoRelatorio: false
    };

    if (!fornecedor) throw new Error('Fornecedor é obrigatório para alertar o fiscal.');
    validateNf(nota);

    const persistedNota = await persistManualPendingNota({ fornecedor, nota, actor: req.user });
    const sent = await sendFiscalMissingPrelaunchEmail({ fornecedor, nota: persistedNota, actor: req.user });
    await auditLog({
      usuarioId: req.user.sub,
      usuarioNome: req.user.nome || req.user.name || null,
      perfil: req.user.perfil,
      acao: "ALERTA_FISCAL_PRE_LANCAMENTO",
      entidade: "AGENDAMENTO",
      entidadeId: null,
      detalhes: { fornecedor, nota: persistedNota, sent, cc: fiscalCcRecipients() || null },
      ip: req.ip
    });

    res.json({ ok: true, nota: persistedNota, ...sent, cc: fiscalCcRecipients() || '' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/financeiro/resumo-mensal", requirePermission("financeiro.summary"), async (req, res) => {
  try {
    const result = await sendMonthlyNearDueDigestIfNeeded({
      triggeredBy: req.user?.nome || req.user?.name || req.user?.sub || 'painel-interno',
      forceSend: true
    });
    await auditLog({
      usuarioId: req.user.sub,
      usuarioNome: req.user.nome || req.user.name || null,
      perfil: req.user.perfil,
      acao: "ENVIAR_RESUMO_FINANCEIRO",
      entidade: "AGENDAMENTO",
      entidadeId: null,
      detalhes: result,
      ip: req.ip
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/:id(\\d+)", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(await enrichResponseItem({ ...item, semaforo: trafficColor(item.status), notificacoes: await safeNotificationSummary(item.id) }));
});

router.post("/", requirePermission("agendamentos.create"), async (req, res) => {
  try {
    const payload = req.body || {};
    payload.cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    payload.notasFiscais = await canonicalizeNotasSelecionadasComRelatorio(payload.fornecedor, Array.isArray(payload.notasFiscais) ? payload.notasFiscais : []);
    const totals = calculateTotals(Array.isArray(payload.notasFiscais) ? payload.notasFiscais : [], payload);
    Object.assign(payload, totals);
    validateAgendamentoPayload(payload, false);

    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(null, payload);
    if (awarenessAnalysis?.requiresAwareness && !payload.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data agendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }

    let defaultDoca;
    try {
      defaultDoca = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } }) || await prisma.doca.findFirst({ orderBy: { id: "asc" } });
    } catch {}
    if (!defaultDoca) {
      const items = readAgendamentos();
      defaultDoca = items.find((i) => i.docaId)?.doca ? null : null;
    }
    payload.docaId = Number(payload.docaId || defaultDoca?.id || 1);

    await assertJanelaDocaDisponivel({ docaId: payload.docaId, janelaId: payload.janelaId, dataAgendada: payload.dataAgendada });

    let item;
    try {
      item = await createAgendamentoInDatabase(payload);
    } catch (dbError) {
      console.error('Erro ao criar agendamento no banco. Usando fallback em arquivo:', dbError?.message || dbError);
      item = createAgendamentoFile({ protocolo: generateProtocol(), publicTokenMotorista: generatePublicToken("MOT", payload.cpfMotorista), publicTokenFornecedor: generatePublicToken("FOR", payload.fornecedor), checkinToken: generatePublicToken("CHK", payload.cpfMotorista || payload.placa), checkoutToken: generatePublicToken("OUT", payload.cpfMotorista || payload.placa), fornecedor: payload.fornecedor, transportadora: payload.transportadora, motorista: payload.motorista, cpfMotorista: payload.cpfMotorista || '', telefoneMotorista: payload.telefoneMotorista || '', emailMotorista: payload.emailMotorista || '', emailTransportadora: payload.emailTransportadora || '', placa: payload.placa, docaId: Number(payload.docaId), janelaId: Number(payload.janelaId), dataAgendada: payload.dataAgendada, horaAgendada: payload.horaAgendada, quantidadeNotas: Number(payload.quantidadeNotas || 0), quantidadeVolumes: Number(payload.quantidadeVolumes || 0), pesoTotalKg: Number(payload.pesoTotalKg || 0), valorTotalNf: Number(payload.valorTotalNf || 0), status: 'PENDENTE_APROVACAO', observacoes: payload.observacoes || '', notasFiscais: payload.notasFiscais || [] });
    }

    await auditLog({ usuarioId: req.user.sub, usuarioNome: req.user.nome || req.user.name || null, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: payload, ip: req.ip });
    try {
      await linkRelatorioRowsToAgendamento(item.id, payload.fornecedor, payload.notasFiscais || []);
    } catch (relatorioError) {
      console.error('[RELATORIO_IMPORT] Falha ao vincular notas do relatório ao agendamento:', relatorioError?.message || relatorioError);
    }
    try {
      const fullItem = await full(item.id);
      await sendFinanceAwarenessIfNeeded({ agendamento: fullItem || item, payload, actor: req.user });
      const notificacaoCriacao = await sendScheduleCreatedNotice(fullItem || item, req, req.user);
      return res.status(201).json(await enrichResponseItem({ ...(fullItem || item), notificacaoCriacao }));
    } catch {
      return res.status(201).json(await enrichResponseItem(item));
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});


router.get('/ocorrencias', requirePermission('agendamentos.view'), async (req, res) => {
  const limit = Math.max(5, Math.min(100, Number(req.query?.limit || 30)));
  try {
    const items = await prisma.logAuditoria.findMany({
      where: { acao: 'OCORRENCIA_AGENDAMENTO', entidade: 'RELATORIO_TERCEIRIZADO' },
      include: { usuario: true },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    return res.json(items.map(normalizeOccurrenceLog));
  } catch (error) {
    console.error('Erro ao carregar histórico de ocorrências no banco. Usando arquivo:', error?.message || error);
    const items = readAuditLogs()
      .filter((item) => String(item?.acao || '').trim() === 'OCORRENCIA_AGENDAMENTO' && String(item?.entidade || '').trim() === 'RELATORIO_TERCEIRIZADO')
      .slice(0, limit)
      .map(normalizeOccurrenceLog);
    return res.json(items);
  }
});

router.post('/ocorrencia', requirePermission('agendamentos.create'), async (req, res) => {
  try {
    const fornecedor = String(req.body?.fornecedor || '').trim();
    const transportadora = String(req.body?.transportadora || '').trim();
    const motivo = String(req.body?.motivo || req.body?.motivoOcorrencia || '').trim();
    const notas = await canonicalizeNotasSelecionadasComRelatorio(fornecedor, Array.isArray(req.body?.notas) ? req.body.notas : []);
    if (!fornecedor) throw new Error('Fornecedor é obrigatório para registrar a ocorrência.');
    if (!notas.length) throw new Error('Selecione ao menos uma NF para registrar a ocorrência.');

    const removal = await removePendingNotasFromRelatorio({ fornecedor, notas });
    const recipients = occurrenceRecipients();
    const mail = buildOccurrenceMail({ transportadora, fornecedor, notas });
    const mailResult = recipients.length
      ? await sendMail({ to: recipients.join(', '), subject: mail.subject, text: mail.text, html: mail.html })
      : { sent: false, reason: 'Destinatários de ocorrência não configurados.' };

    await auditLog({
      usuarioId: req.user.sub,
      usuarioNome: req.user.nome || req.user.name || null,
      perfil: req.user.perfil,
      acao: 'OCORRENCIA_AGENDAMENTO',
      entidade: 'RELATORIO_TERCEIRIZADO',
      entidadeId: null,
      detalhes: {
        fornecedor,
        transportadora,
        motivo: motivo || null,
        totalNotas: notas.length,
        notas: notas.map((nota) => ({
          rowHash: nota?.rowHash || null,
          numeroNf: String(nota?.numeroNf || '').trim(),
          serie: String(nota?.serie || '').trim(),
          destino: String(nota?.destino || nota?.empresa || '').trim(),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0)
        })),
        recipients,
        removal,
        mailResult
      },
      ip: req.ip
    });

    return res.json({
      ok: true,
      message: mailResult.sent
        ? `Ocorrência registrada. ${notas.length} NF removida(s) da fila pendente e e-mail enviado.`
        : `Ocorrência registrada. ${notas.length} NF removida(s) da fila pendente. ${mailResult.reason || 'E-mail não enviado.'}`,
      removed: removal,
      email: mailResult
    });
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Falha ao registrar ocorrência.' });
  }
});

async function transition(id, target, data = {}, req) {
  const found = await mustExist(id);
  if (!found) throw new Error("Agendamento não encontrado.");
  if (found.status !== target) validateStatusTransition(found.status, target);
  let updated;
  if (found.status === target) {
    updated = await mustExist(id);
  } else {
    try { updated = await prisma.agendamento.update({ where: { id: Number(id) }, data: { ...data, status: target } }); }
    catch { updated = updateAgendamentoFile(id, { ...data, status: target }); }
  }

  await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: target, entidade: "AGENDAMENTO", entidadeId: updated.id, detalhes: data, ip: req.ip });
  return updated;
}

router.post("/:id(\\d+)/definir-doca", requirePermission("agendamentos.definir_doca"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    const docaId = Number(req.body?.docaId);
    if (!docaId) throw new Error("Doca é obrigatória.");
    if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW"].includes(found.status)) {
      throw new Error("Não é possível alterar a doca para este status.");
    }

    try {
      await assertJanelaDocaDisponivel({
        docaId,
        janelaId: found.janelaId,
        dataAgendada: found.dataAgendada,
        ignoreAgendamentoId: found.id
      });
    } catch {}

    let item;
    try { item = await prisma.agendamento.update({ where: { id: found.id }, data: { docaId } }); }
    catch { item = updateAgendamentoFile(found.id, { docaId, doca: undefined }); }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "DEFINIR_DOCA", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { docaId }, ip: req.ip });
    res.json(await full(item.id));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id(\\d+)/aprovar", requirePermission("agendamentos.approve"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");

    const data = {};
    if (req.body?.docaId) data.docaId = Number(req.body.docaId);
    if (req.body?.janelaId) data.janelaId = Number(req.body.janelaId);
    if (req.body?.dataAgendada) data.dataAgendada = String(req.body.dataAgendada);
    if (req.body?.horaAgendada) data.horaAgendada = String(req.body.horaAgendada);

    const merged = {
      ...found,
      ...data,
      notasFiscais: Array.isArray(found.notasFiscais) ? found.notasFiscais : []
    };

    if (!merged.docaId) throw new Error("Doca é obrigatória para aprovação.");
    if (!merged.janelaId) throw new Error("Janela é obrigatória para aprovação.");
    if (!merged.dataAgendada) throw new Error("Data agendada é obrigatória para aprovação.");
    if (!merged.horaAgendada) throw new Error("Hora agendada é obrigatória para aprovação.");
    if (!Array.isArray(merged.notasFiscais) || !merged.notasFiscais.length) {
      throw new Error("Selecione ao menos uma NF para o agendamento interno.");
    }

    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(found, merged);
    if (awarenessAnalysis?.requiresAwareness && !req.body?.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data agendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }

    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    const updated = await transition(req.params.id, "APROVADO", data, req);
    let item = await full(updated.id);
    const resolvedSchedule = resolveScheduleValues(item, merged);
    const missingSchedulePatch = {};
    if (!String(item?.dataAgendada || '').trim() && resolvedSchedule.dataAgendada) missingSchedulePatch.dataAgendada = resolvedSchedule.dataAgendada;
    if (!String(item?.horaAgendada || '').trim() && resolvedSchedule.horaAgendada) missingSchedulePatch.horaAgendada = resolvedSchedule.horaAgendada;
    if (Object.keys(missingSchedulePatch).length) {
      try {
        await prisma.agendamento.update({ where: { id: Number(updated.id) }, data: missingSchedulePatch });
      } catch {
        updateAgendamentoFile(updated.id, missingSchedulePatch);
      }
      item = await full(updated.id);
    }
    item = normalizeScheduleItem(item, merged);
    await sendFinanceAwarenessIfNeeded({ agendamento: item, payload: { ...merged, confirmarCienciaVencimento: req.body?.confirmarCienciaVencimento }, actor: req.user });
    const notificacoes = await sendApprovalNotifications(item, req);
    res.json(await enrichResponseItem({
      ...item,
      notificacoesEnviadas: notificacoes.results,
      envioAutomatico: true,
      message: "Agendamento aprovado e voucher enviado aos destinatários cadastrados."
    }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id(\\d+)/reprovar", requirePermission("agendamentos.reprove"), async (req, res) => {
  try {
    const item = await transition(req.params.id, "REPROVADO", { motivoReprovacao: req.body?.motivo || "Reprovado" }, req);
    await unlinkRelatorioRowsFromAgendamento(item?.id);
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/reagendar", requirePermission("agendamentos.reschedule"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível reagendar esse status.");

    const merged = {
      ...found,
      dataAgendada: req.body?.dataAgendada || found.dataAgendada,
      horaAgendada: req.body?.horaAgendada || found.horaAgendada,
      docaId: req.body?.docaId || found.docaId,
      janelaId: req.body?.janelaId || found.janelaId
    };
    validateAgendamentoPayload(merged, false);
    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(found, merged);
    if (awarenessAnalysis?.requiresAwareness && !req.body?.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data reagendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }
    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    let item;
    try {
      item = await prisma.agendamento.update({
        where: { id: Number(req.params.id) },
        data: { dataAgendada: merged.dataAgendada, horaAgendada: merged.horaAgendada, docaId: Number(merged.docaId), janelaId: Number(merged.janelaId), status: "PENDENTE_APROVACAO" }
      });
    } catch {
      item = updateAgendamentoFile(req.params.id, { dataAgendada: merged.dataAgendada, horaAgendada: merged.horaAgendada, docaId: Number(merged.docaId), janelaId: Number(merged.janelaId), status: "PENDENTE_APROVACAO" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "REAGENDAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    const fullItem = await full(item.id);
    await sendFinanceAwarenessIfNeeded({ agendamento: fullItem || item, payload: { ...merged, confirmarCienciaVencimento: req.body?.confirmarCienciaVencimento }, actor: req.user });
    res.json(await enrichResponseItem(fullItem || item));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/cancelar", requirePermission("agendamentos.cancel"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível cancelar esse status.");
    let item;
    try {
      item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" } });
    } catch {
      item = updateAgendamentoFile(req.params.id, { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    await unlinkRelatorioRowsFromAgendamento(item?.id);
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/iniciar", requirePermission("agendamentos.start"), async (req, res) => {
  try { res.json(await transition(req.params.id, "EM_DESCARGA", { inicioDescargaEm: new Date() }, req)); } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/finalizar", requirePermission("agendamentos.finish"), uploadAvariaMiddleware, async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (found.status === "FINALIZADO") {
      return res.json({ ...found, message: "Agendamento já estava finalizado." });
    }

    const recebimento = normalizeFinalizacaoRecebimento(req.body || {});
    const patch = {
      fimDescargaEm: new Date(),
      observacoes: mergeOperationalObservations(found.observacoes, recebimento)
    };

    const updated = await transition(req.params.id, "FINALIZADO", patch, req);
    const item = normalizeScheduleItem(await full(updated.id), found);
    const ocorrenciaRecebimento = await notifyControladoriaAvaria({ agendamento: item, payload: recebimento, req, actor: req.user, files: uploadedAvariaFilesFromReq(req) });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "FINALIZAR_DESCARGA", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { origem: 'painel-interno', recebimento, ocorrenciaRecebimento }, ip: req.ip });
    const avaliacao = await dispatchDriverFeedbackSurvey(item, req, req.user);
    res.json({ ...item, avaliacao, recebimento, ocorrenciaRecebimento });
  } catch (err) {
    logTechnicalEvent('internal-finalization-error', { agendamentoId: Number(req.params.id || 0) || null, reason: err?.message || String(err), route: req.originalUrl || req.url });
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id(\\d+)/no-show", requirePermission("agendamentos.no_show"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["PENDENTE_APROVACAO", "APROVADO"].includes(found.status)) throw new Error("No-show só pode ser aplicado antes da descarga.");
    let item;
    try {
      item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "NO_SHOW" } });
    } catch {
      item = updateAgendamentoFile(req.params.id, { status: "NO_SHOW" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "NO_SHOW", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: null, ip: req.ip });
    await unlinkRelatorioRowsFromAgendamento(item?.id);
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/checkin", requirePermission("agendamentos.checkin"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["APROVADO", "CHEGOU"].includes(found.status)) throw new Error("Check-in só é permitido para agendamento aprovado.");
    const item = await transition(req.params.id, "CHEGOU", { checkinEm: found.checkinEm || new Date() }, req);
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CHECKIN_MANUAL", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { origem: 'painel-interno' }, ip: req.ip });
    res.json({ ok: true, message: "Check-in validado pelo operador do recebimento.", agendamento: item });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id(\\d+)/documentos", requirePermission("agendamentos.documentos"), uploadMiddleware, async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });
    let item;
    try {
      item = await prisma.documento.create({ data: { agendamentoId: ag.id, tipoDocumento: req.body?.tipoDocumento || "ANEXO", nomeArquivo: req.file.originalname, urlArquivo: req.file.path.replace(/\\/g, "/") } });
    } catch {
      item = addDocumentoFile({ agendamentoId: ag.id, tipoDocumento: req.body?.tipoDocumento || "ANEXO", nomeArquivo: req.file.originalname, urlArquivo: req.file.path.replace(/\\/g, "/") });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "UPLOAD_DOCUMENTO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { nomeArquivo: req.file.originalname }, ip: req.ip });
    res.status(201).json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/notas", requirePermission("agendamentos.notas"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    const payload = { ...req.body, chaveAcesso: normalizeChaveAcesso(req.body?.chaveAcesso || "") };
    validateNf(payload);
    let item;
    try {
      item = await prisma.notaFiscal.create({
        data: {
          agendamentoId: ag.id,
          numeroNf: payload.numeroNf || "",
          serie: payload.serie || "",
          chaveAcesso: payload.chaveAcesso || "",
          volumes: Number(payload.volumes || 0),
          peso: Number(payload.peso || 0),
          valorNf: Number(payload.valorNf || 0),
          observacao: encodeNotaObservacao(payload)
        }
      });
    } catch {
      item = addNotaFile(ag.id, {
        numeroNf: payload.numeroNf || "",
        serie: payload.serie || "",
        chaveAcesso: payload.chaveAcesso || "",
        volumes: Number(payload.volumes || 0),
        peso: Number(payload.peso || 0),
        valorNf: Number(payload.valorNf || 0),
        observacao: encodeNotaObservacao(payload)
      });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ADD_NF", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: payload, ip: req.ip });
    res.status(201).json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/enviar-informacoes", requirePermission("agendamentos.notify"), async (req, res) => {
  try {
    const item = await full(req.params.id);
    if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
    const out = await sendApprovalNotifications(item, req);
    if (!out.results.length) return res.status(400).json({ message: "Não há e-mails cadastrados no agendamento." });
    res.json({ ok: true, results: out.results, ...out.links, tokenMotorista: item.publicTokenMotorista, tokenConsulta: item.publicTokenFornecedor });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id(\\d+)/enviar-confirmacao", requirePermission("agendamentos.notify"), async (req, res) => {
  try {
    const ag = await full(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!ag.emailTransportadora) return res.status(400).json({ message: "Não há e-mail da transportadora/fornecedor cadastrado." });
    if (!canShareVoucher(ag)) return res.status(400).json({ message: "O voucher só pode ser enviado após a aprovação do agendamento." });

    const normalizedAg = normalizeScheduleItem(ag);
    const links = buildPublicLinks(req, normalizedAg);
    const pdf = await generateVoucherPdf(normalizedAg, { baseUrl: getBaseUrl(req) });
    const textoDoca = normalizedAg.doca?.codigo || normalizedAg.doca || "A DEFINIR";
    const scheduleIntro = buildScheduleIntro(normalizedAg);
    const sent = await sendMail({
      to: normalizedAg.emailTransportadora,
      subject: `Confirmação do agendamento ${normalizedAg.protocolo}`,
      text: `${scheduleIntro}
Protocolo: ${normalizedAg.protocolo}
Doca: ${textoDoca}
Consulta: ${links.consulta}

${MANDATORY_VOUCHER_NOTICE_TEXT}`,
      html: `<p>${scheduleIntro}</p><p><strong>Protocolo:</strong> ${normalizedAg.protocolo}</p><p><strong>Data:</strong> ${formatDateBR(normalizedAg.dataAgendada)}</p><p><strong>Hora:</strong> ${formatHourLabel(normalizedAg.horaAgendada)}</p><p><strong>Doca:</strong> ${textoDoca}</p><p><a href="${links.consulta}">Consulta do agendamento</a></p><p>${MANDATORY_VOUCHER_NOTICE_HTML}</p>`,
      attachments: [{ filename: `voucher-${normalizedAg.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ENVIAR_CONFIRMACAO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { targets: ["transportadora/fornecedor"] }, ip: req.ip });
    res.json({ ok: true, sent, to: normalizedAg.emailTransportadora, consulta: links.consulta, voucher: links.voucher });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/:id(\\d+)/qrcode.svg", async (req, res) => {
  const item = await mustExist(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const url = `${getBaseUrl(req)}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`;
  const svg = await qrSvg(url);
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

router.get("/:id(\\d+)/voucher", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=voucher-${item.protocolo}.pdf`);
  res.send(pdf);
});

export default router;
