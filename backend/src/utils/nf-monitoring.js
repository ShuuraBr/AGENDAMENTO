import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { sendMail } from './email.js';
import { readAgendamentos } from './file-store.js';
import { normalizeAgendamentoNotas } from './nota-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const rawFallbackFile = path.join(backendRoot, 'data', 'relatorio-terceirizado-raw.json');
const monitorStateFile = path.join(backendRoot, 'data', 'financeiro-monitoramento.json');
const TABLE_NAME = 'RelatorioTerceirizado';
const NEAR_DUE_DAYS = 5;
const AWARENESS_GAP_DAYS = 3;

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeText(value = '') {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeDigits(value = '') {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeSerie(value = '') {
  return normalizeText(value).toUpperCase();
}

function quoteIdentifier(value = '') {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function toDateOnly(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function parseFlexibleDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : toDateOnly(date);
  }
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const date = new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
    return Number.isNaN(date.getTime()) ? null : toDateOnly(date);
  }
  const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T].*$/);
  if (compact) {
    const date = new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3])));
    return Number.isNaN(date.getTime()) ? null : toDateOnly(date);
  }
  const native = new Date(raw);
  return Number.isNaN(native.getTime()) ? null : toDateOnly(new Date(Date.UTC(native.getUTCFullYear(), native.getUTCMonth(), native.getUTCDate())));
}

export function formatDateBR(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value);
  if (!date) return '-';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function toIsoDate(value) {
  const date = value instanceof Date ? value : parseFlexibleDate(value);
  if (!date) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear());
  return `${yyyy}-${mm}-${dd}`;
}

function diffDays(start, end) {
  if (!(start instanceof Date) || !(end instanceof Date)) return null;
  const ms = toDateOnly(end).getTime() - toDateOnly(start).getTime();
  return Math.round(ms / 86400000);
}

function buildTooltip({ dueDate, daysUntilDue, daysBetweenScheduleAndDue }) {
  const parts = [];
  if (dueDate) parts.push(`1º vencimento em ${formatDateBR(dueDate)}`);
  if (Number.isFinite(daysUntilDue)) parts.push(daysUntilDue === 0 ? 'vence hoje' : `vence em ${daysUntilDue} dia(s)`);
  if (Number.isFinite(daysBetweenScheduleAndDue)) parts.push(`diferença para o agendamento: ${daysBetweenScheduleAndDue} dia(s)`);
  return parts.join(' • ');
}

export function computeDueInfo({ dueDateValue, scheduledDateValue = null } = {}) {
  const dueDate = parseFlexibleDate(dueDateValue);
  const scheduledDate = parseFlexibleDate(scheduledDateValue);
  const today = todayUtc();
  const daysUntilDue = dueDate ? diffDays(today, dueDate) : null;
  const daysBetweenScheduleAndDue = dueDate && scheduledDate ? diffDays(scheduledDate, dueDate) : null;
  const nearDue = Number.isFinite(daysUntilDue) && daysUntilDue >= 0 && daysUntilDue <= NEAR_DUE_DAYS;
  const requiresAwareness = Boolean(
    dueDate
    && scheduledDate
    && Number.isFinite(daysBetweenScheduleAndDue)
    && daysBetweenScheduleAndDue >= 0
    && daysBetweenScheduleAndDue <= AWARENESS_GAP_DAYS
  );
  return {
    dueDate,
    dueDateIso: dueDate ? toIsoDate(dueDate) : '',
    dueDateBr: dueDate ? formatDateBR(dueDate) : '',
    daysUntilDue,
    daysBetweenScheduleAndDue,
    nearDue,
    requiresAwareness,
    tooltip: dueDate ? buildTooltip({ dueDate, daysUntilDue, daysBetweenScheduleAndDue }) : ''
  };
}

function financeRecipient() {
  return normalizeText(
    process.env.FINANCEIRO_EMAIL
    || process.env.EMAIL_FINANCEIRO
    || process.env.FINANCE_EMAIL
    || process.env.SETOR_FINANCEIRO_EMAIL
    || ''
  );
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvEscape(value = '') {
  const raw = String(value ?? '');
  if (/[";,\n\r]/.test(raw)) return `"${raw.replaceAll('"', '""')}"`;
  return raw;
}

function buildMonthlyDigestAttachment(rows = [], monthKey = '') {
  const headers = [
    'Fornecedor',
    'Empresa',
    'Destino',
    'NF',
    'Série',
    'Data de entrada',
    '1º vencimento',
    'Dias para vencer',
    'Status no relatório',
    'Agendamento vinculado'
  ];

  const lines = [headers.join(';')];
  for (const item of rows) {
    lines.push([
      item.fornecedor || '-',
      item.empresa || '-',
      item.destino || '-',
      item.numeroNf || '-',
      item.serie || '-',
      item.dataEntradaBr || '-',
      item.dataPrimeiroVencimentoBr || '-',
      item.diasParaPrimeiroVencimento == null ? '-' : item.diasParaPrimeiroVencimento,
      item.statusRelatorio || '-',
      item.agendamentoId || ''
    ].map(csvEscape).join(';'));
  }

  return {
    filename: `resumo-financeiro-${monthKey}.csv`,
    content: Buffer.from(`﻿${lines.join('\r\n')}`, 'utf8'),
    contentType: 'text/csv; charset=utf-8'
  };
}

function buildMonthlyDigestHtmlTable(rows = []) {
  if (!rows.length) return '<p>Nenhuma NF encontrada para o período.</p>';
  return `
    <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px">
      <thead>
        <tr style="background:#e2e8f0">
          <th align="left">Fornecedor</th>
          <th align="left">Empresa</th>
          <th align="left">Destino</th>
          <th align="left">NF</th>
          <th align="left">Série</th>
          <th align="left">Data entrada</th>
          <th align="left">1º vencimento</th>
          <th align="left">Dias</th>
          <th align="left">Status</th>
          <th align="left">Ag.</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.fornecedor || '-')}</td>
            <td>${escapeHtml(item.empresa || '-')}</td>
            <td>${escapeHtml(item.destino || '-')}</td>
            <td>${escapeHtml(item.numeroNf || '-')}</td>
            <td>${escapeHtml(item.serie || '-')}</td>
            <td>${escapeHtml(item.dataEntradaBr || '-')}</td>
            <td>${escapeHtml(item.dataPrimeiroVencimentoBr || '-')}</td>
            <td>${escapeHtml(item.diasParaPrimeiroVencimento == null ? '-' : item.diasParaPrimeiroVencimento)}</td>
            <td>${escapeHtml(item.statusRelatorio || '-')}</td>
            <td>${escapeHtml(item.agendamentoId || '-')}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function readMonitorState() {
  try {
    if (!fs.existsSync(monitorStateFile)) return {};
    return JSON.parse(fs.readFileSync(monitorStateFile, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeMonitorState(state = {}) {
  ensureDir(monitorStateFile);
  fs.writeFileSync(monitorStateFile, JSON.stringify(state, null, 2), 'utf8');
}

function normalizeRelatorioRow(row = {}) {
  const original = row?.dadosOriginaisJson
    ? (() => {
        try { return JSON.parse(String(row.dadosOriginaisJson)); } catch { return {}; }
      })()
    : row;

  const merged = { ...original, ...row };
  const numeroNf = normalizeText(merged['Nr. nota'] ?? merged.numeroNf ?? merged.numero_nf);
  const serie = normalizeText(merged['Série'] ?? merged.serie ?? merged.Serie);
  const fornecedor = normalizeText(merged['Fornecedor'] ?? merged.fornecedor);
  const vencimento = normalizeText(merged['Data 1º vencimento'] ?? merged['Data 1o vencimento'] ?? merged.dataPrimeiroVencimento ?? merged.vencimento);
  const status = normalizeText(merged['Status'] ?? merged.status);
  const dataEntrada = normalizeText(merged['Data de Entrada'] ?? merged.dataEntrada);
  const dataCadastro = normalizeText(merged['Data do cadastro'] ?? merged.dataCadastro);
  const entrada = normalizeText(merged['Entrada'] ?? merged.entrada);
  const empresa = normalizeText(merged['Empresa'] ?? merged.empresa);
  const destino = normalizeText(merged['Destino'] ?? merged.destino);
  const rowHash = normalizeText(merged.rowHash);
  const dueInfo = computeDueInfo({ dueDateValue: vencimento });
  const entryInfo = computeDueInfo({ dueDateValue: dataEntrada });
  const cadastroInfo = computeDueInfo({ dueDateValue: dataCadastro });
  return {
    rowHash,
    agendamentoId: merged.agendamentoId == null ? null : Number(merged.agendamentoId),
    fornecedor,
    numeroNf,
    serie,
    empresa,
    destino,
    entrada,
    status,
    dataEntrada: entryInfo.dueDateIso || '',
    dataEntradaBr: entryInfo.dueDateBr || dataEntrada,
    dataCadastro: cadastroInfo.dueDateIso || '',
    dataCadastroBr: cadastroInfo.dueDateBr || dataCadastro,
    dataPrimeiroVencimento: dueInfo.dueDateIso,
    dataPrimeiroVencimentoBr: dueInfo.dueDateBr,
    diasParaPrimeiroVencimento: dueInfo.daysUntilDue,
    alertaVencimentoProximo: dueInfo.nearDue,
    tooltipVencimento: dueInfo.tooltip,
    raw: merged
  };
}

async function loadRelatorioRowsFromDb() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT rowHash, agendamentoId, ${quoteIdentifier('Fornecedor')} AS fornecedorRaw, ${quoteIdentifier('Nr. nota')} AS numeroNfRaw, ${quoteIdentifier('Série')} AS serieRaw, ${quoteIdentifier('Status')} AS statusRaw, ${quoteIdentifier('Data 1º vencimento')} AS vencimentoRaw, ${quoteIdentifier('Data de Entrada')} AS dataEntradaRaw, ${quoteIdentifier('Data do cadastro')} AS dataCadastroRaw, ${quoteIdentifier('Entrada')} AS entradaRaw, ${quoteIdentifier('Empresa')} AS empresaRaw, ${quoteIdentifier('Destino')} AS destinoRaw, dadosOriginaisJson FROM ${quoteIdentifier(TABLE_NAME)}`
  );
  return (rows || []).map((row) => normalizeRelatorioRow({
    rowHash: row.rowHash,
    agendamentoId: row.agendamentoId,
    dadosOriginaisJson: row.dadosOriginaisJson,
    'Fornecedor': row.fornecedorRaw,
    'Nr. nota': row.numeroNfRaw,
    'Série': row.serieRaw,
    'Status': row.statusRaw,
    'Data 1º vencimento': row.vencimentoRaw,
    'Data de Entrada': row.dataEntradaRaw,
    'Data do cadastro': row.dataCadastroRaw,
    'Entrada': row.entradaRaw,
    'Empresa': row.empresaRaw,
    'Destino': row.destinoRaw
  }));
}

function loadRelatorioRowsFromFile() {
  try {
    if (!fs.existsSync(rawFallbackFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(rawFallbackFile, 'utf8')) || [];
    return Array.isArray(parsed) ? parsed.map((row) => normalizeRelatorioRow(row)) : [];
  } catch {
    return [];
  }
}

export async function getRelatorioRowsSnapshot() {
  try {
    return await loadRelatorioRowsFromDb();
  } catch {
    return loadRelatorioRowsFromFile();
  }
}

function noteMatch(row, nota = {}) {
  const rowHash = normalizeText(nota?.rowHash);
  if (rowHash && row.rowHash && rowHash === row.rowHash) return true;
  const nfA = normalizeDigits(nota?.numeroNf);
  const nfB = normalizeDigits(row.numeroNf);
  if (!nfA || !nfB || nfA !== nfB) return false;
  const serieNota = normalizeSerie(nota?.serie);
  const serieRow = normalizeSerie(row.serie);
  if (serieNota && serieRow) return serieNota === serieRow;
  return true;
}

function enrichNoteWithRelatorio(nota = {}, row = null, scheduledDateValue = null) {
  const dueInfo = computeDueInfo({ dueDateValue: row?.dataPrimeiroVencimento || row?.dataPrimeiroVencimentoBr || '', scheduledDateValue });
  return {
    ...nota,
    disponivelNoRelatorio: !!row,
    rowHash: normalizeText(nota?.rowHash || row?.rowHash || ''),
    empresa: normalizeText(nota?.empresa || row?.empresa || ''),
    destino: normalizeText(nota?.destino || row?.destino || ''),
    entrada: normalizeText(nota?.entrada || row?.entrada || ''),
    dataEntrada: normalizeText(nota?.dataEntrada || row?.dataEntrada || ''),
    dataEntradaBr: normalizeText(nota?.dataEntradaBr || row?.dataEntradaBr || ''),
    dataPrimeiroVencimento: dueInfo.dueDateIso,
    dataPrimeiroVencimentoBr: dueInfo.dueDateBr,
    diasParaPrimeiroVencimento: dueInfo.daysUntilDue,
    diasEntreAgendamentoEVencimento: dueInfo.daysBetweenScheduleAndDue,
    alertaVencimentoProximo: dueInfo.nearDue,
    requerCienciaVencimento: dueInfo.requiresAwareness,
    tooltipVencimento: dueInfo.tooltip,
    statusRelatorio: row?.status || null,
    fornecedorRelatorio: row?.fornecedor || null
  };
}

export async function analyzeNotesForSchedule({ notas = [], dataAgendada = '', fornecedor = '' } = {}) {
  const selected = normalizeAgendamentoNotas(Array.isArray(notas) ? notas : []);
  const rows = await getRelatorioRowsSnapshot();
  const matchedRows = [];
  const enrichedNotas = selected.map((nota) => {
    const row = rows.find((item) => noteMatch(item, nota) && (!fornecedor || !item.fornecedor || normalizeText(item.fornecedor).toLowerCase() === normalizeText(fornecedor).toLowerCase()));
    if (row) matchedRows.push(row);
    return enrichNoteWithRelatorio(nota, row, dataAgendada);
  });
  const notasComCiencia = enrichedNotas.filter((nota) => nota.requerCienciaVencimento);
  const notasComVencimentoProximo = enrichedNotas.filter((nota) => nota.alertaVencimentoProximo);
  const notasAusentesNoRelatorio = enrichedNotas.filter((nota) => nota.disponivelNoRelatorio === false);
  return {
    requiresAwareness: notasComCiencia.length > 0,
    notas: enrichedNotas,
    notasComCiencia,
    notasComVencimentoProximo,
    notasAusentesNoRelatorio,
    resumo: {
      totalNotas: enrichedNotas.length,
      totalComCiencia: notasComCiencia.length,
      totalComVencimentoProximo: notasComVencimentoProximo.length,
      totalAusentesNoRelatorio: notasAusentesNoRelatorio.length
    }
  };
}

export async function enrichAgendamentoWithMonitoring(item = {}) {
  const analysis = await analyzeNotesForSchedule({
    notas: normalizeAgendamentoNotas(Array.isArray(item.notasFiscais) ? item.notasFiscais : Array.isArray(item.notas) ? item.notas : []),
    dataAgendada: item.dataAgendada,
    fornecedor: item.fornecedor
  });
  return {
    ...item,
    notasFiscais: analysis.notas,
    monitoramentoNf: {
      alertaCienciaVencimento: analysis.requiresAwareness,
      notasComVencimentoProximo: analysis.notasComVencimentoProximo,
      notasAusentesNoRelatorio: analysis.notasAusentesNoRelatorio,
      resumo: analysis.resumo
    }
  };
}

function buildAwarenessEmailBody({ agendamento, analysis, actor }) {
  const linhas = (analysis?.notasComCiencia || []).map((nota) => (
    `NF ${nota.numeroNf || '-'} | Série ${nota.serie || '-'} | 1º vencimento ${nota.dataPrimeiroVencimentoBr || '-'} | agendamento ${formatDateBR(agendamento.dataAgendada)} | diferença ${nota.diasEntreAgendamentoEVencimento ?? '-'} dia(s)`
  )).join('\n');

  const operador = normalizeText(actor?.nome || actor?.name || actor?.email || actor?.sub || 'Não identificado');
  return {
    subject: `Alerta financeiro: agendamento próximo ao vencimento (${agendamento.protocolo || 'sem protocolo'})`,
    text: [
      'Foi confirmado um agendamento com nota(s) próxima(s) do 1º vencimento.',
      '',
      `Protocolo: ${agendamento.protocolo || '-'}`,
      `Fornecedor: ${agendamento.fornecedor || '-'}`,
      `Transportadora: ${agendamento.transportadora || '-'}`,
      `Motorista: ${agendamento.motorista || '-'}`,
      `Placa: ${agendamento.placa || '-'}`,
      `Data agendada: ${formatDateBR(agendamento.dataAgendada)}`,
      `Hora agendada: ${agendamento.horaAgendada || '-'}`,
      `Operador responsável: ${operador}`,
      '',
      'Notas em atenção:',
      linhas || 'Nenhuma nota detalhada.'
    ].join('\n'),
    html: `
      <p>Foi confirmado um agendamento com nota(s) próxima(s) do 1º vencimento.</p>
      <p><strong>Protocolo:</strong> ${agendamento.protocolo || '-'}<br>
      <strong>Fornecedor:</strong> ${agendamento.fornecedor || '-'}<br>
      <strong>Transportadora:</strong> ${agendamento.transportadora || '-'}<br>
      <strong>Motorista:</strong> ${agendamento.motorista || '-'}<br>
      <strong>Placa:</strong> ${agendamento.placa || '-'}<br>
      <strong>Data agendada:</strong> ${formatDateBR(agendamento.dataAgendada)}<br>
      <strong>Hora agendada:</strong> ${agendamento.horaAgendada || '-'}<br>
      <strong>Operador responsável:</strong> ${operador}</p>
      <p><strong>Notas em atenção:</strong></p>
      <ul>${(analysis?.notasComCiencia || []).map((nota) => `<li>NF ${nota.numeroNf || '-'} | Série ${nota.serie || '-'} | 1º vencimento ${nota.dataPrimeiroVencimentoBr || '-'} | agendamento ${formatDateBR(agendamento.dataAgendada)} | diferença ${nota.diasEntreAgendamentoEVencimento ?? '-'} dia(s)</li>`).join('')}</ul>
    `
  };
}

export async function sendFinanceAwarenessEmail({ agendamento, analysis, actor } = {}) {
  const to = financeRecipient();
  if (!to) return { sent: false, reason: 'E-mail do financeiro não configurado.' };
  if (!analysis?.notasComCiencia?.length) return { sent: false, reason: 'Nenhuma nota requer ciência.' };
  const mail = buildAwarenessEmailBody({ agendamento, analysis, actor });
  return sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html });
}

export async function sendMonthlyNearDueDigestIfNeeded({ triggeredBy = '', forceSend = false } = {}) {
  const to = financeRecipient();
  if (!to) return { sent: false, reason: 'E-mail do financeiro não configurado.' };

  const now = new Date();
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rows = await getRelatorioRowsSnapshot();
  const nearDue = rows
    .filter((row) => row.alertaVencimentoProximo && String(row.dataPrimeiroVencimento || '').startsWith(monthKey))
    .sort((a, b) => {
      const dueA = String(a.dataPrimeiroVencimento || '9999-99-99');
      const dueB = String(b.dataPrimeiroVencimento || '9999-99-99');
      if (dueA !== dueB) return dueA.localeCompare(dueB);
      const fa = normalizeText(a.fornecedor).localeCompare(normalizeText(b.fornecedor), 'pt-BR');
      if (fa !== 0) return fa;
      return normalizeDigits(a.numeroNf).localeCompare(normalizeDigits(b.numeroNf));
    });

  if (!nearDue.length) return { sent: false, reason: 'Nenhuma NF com vencimento próximo no mês atual.' };

  const signature = crypto.createHash('sha256').update(JSON.stringify(nearDue.map((item) => ({ fornecedor: item.fornecedor, numeroNf: item.numeroNf, serie: item.serie, dataPrimeiroVencimento: item.dataPrimeiroVencimento, agendamentoId: item.agendamentoId })))).digest('hex');
  const state = readMonitorState();
  const digestState = state.monthlyDigest || {};

  if (!forceSend && digestState.monthKey === monthKey && digestState.signature === signature) {
    return { sent: false, reason: 'Resumo mensal já enviado para este cenário.' };
  }

  const qtdFornecedores = new Set(nearDue.map((item) => normalizeText(item.fornecedor).toLowerCase()).filter(Boolean)).size;
  const csvAttachment = buildMonthlyDigestAttachment(nearDue, monthKey);
  const subject = `Resumo financeiro mensal: NFs com vencimento próximo (${monthKey})`;
  const text = [
    'Resumo mensal de notas com 1º vencimento próximo.',
    '',
    `Mês de referência: ${monthKey}`,
    `Disparo: ${normalizeText(triggeredBy) || 'sistema'}`,
    `Total de NFs: ${nearDue.length}`,
    `Total de fornecedores: ${qtdFornecedores}`,
    '',
    'A planilha CSV com o detalhamento segue em anexo.'
  ].join('\n');
  const html = `
    <p>Resumo mensal de notas com <strong>1º vencimento próximo</strong>.</p>
    <p>
      <strong>Mês de referência:</strong> ${escapeHtml(monthKey)}<br>
      <strong>Disparo:</strong> ${escapeHtml(normalizeText(triggeredBy) || 'sistema')}<br>
      <strong>Total de NFs:</strong> ${escapeHtml(nearDue.length)}<br>
      <strong>Total de fornecedores:</strong> ${escapeHtml(qtdFornecedores)}
    </p>
    <p>A planilha CSV com o detalhamento segue em anexo.</p>
    ${buildMonthlyDigestHtmlTable(nearDue)}
  `;
  const sent = await sendMail({ to, subject, text, html, attachments: [csvAttachment] });

  if (sent?.sent) {
    writeMonitorState({
      ...state,
      monthlyDigest: {
        monthKey,
        signature,
        sentAt: new Date().toISOString()
      }
    });
  }

  return { ...sent, totalNotas: nearDue.length, totalFornecedores: qtdFornecedores, attachment: csvAttachment.filename };
}

export async function searchByNumeroNf(numeroNf = '') {
  const targetDigits = normalizeDigits(numeroNf);
  if (!targetDigits) return { relatorio: [], agendamentos: [] };
  const rows = await getRelatorioRowsSnapshot();
  const relatorio = rows.filter((row) => normalizeDigits(row.numeroNf).includes(targetDigits));

  let ags = [];
  try {
    ags = await prisma.agendamento.findMany({ include: { notasFiscais: true, doca: true, janela: true }, orderBy: { id: 'desc' } });
  } catch {
    ags = readAgendamentos();
  }
  const agendamentos = ags.filter((item) => normalizeAgendamentoNotas(Array.isArray(item.notasFiscais) ? item.notasFiscais : []).some((nota) => normalizeDigits(nota.numeroNf).includes(targetDigits)));
  return { relatorio, agendamentos };
}
