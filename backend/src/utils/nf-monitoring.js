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
const RELATORIO_DB_READ_COOLDOWN_MS = 10 * 60 * 1000;
const MONTHLY_DIGEST_CHECK_COOLDOWN_MS = 5 * 60 * 1000;

let relatorioDbReadDisabledReason = '';
let relatorioDbReadDisabledAt = 0;
let lastMonthlyDigestCheckAt = 0;
let monthlyDigestInFlight = null;

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

function isPrismaPanicLike(error) {
  const message = String(error?.message || error || '');
  return message.includes('PANIC: timer has gone away')
    || message.includes('PrismaClientRustPanicError')
    || message.includes('This is a non-recoverable error')
    || message.includes('Raw query failed. Code: `N/A`')
    || message.includes('Raw query failed. Code: `N/A`. Message: `N/A`');
}

function disableRelatorioDbReads(error, context = 'relatorio_db_read') {
  relatorioDbReadDisabledAt = Date.now();
  relatorioDbReadDisabledReason = `${context}: ${error?.message || String(error || 'erro_desconhecido')}`;
  console.error(`[NF_MONITOR] Leitura do relatório via banco desabilitada temporariamente. Motivo: ${relatorioDbReadDisabledReason}`);
}

function isRelatorioDbReadDisabled() {
  return relatorioDbReadDisabledAt > 0 && (Date.now() - relatorioDbReadDisabledAt) < RELATORIO_DB_READ_COOLDOWN_MS;
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

function digestRowTheme(item = {}) {
  const dias = Number(item?.diasParaPrimeiroVencimento);
  if (Number.isFinite(dias) && dias <= 1) {
    return {
      label: dias < 0 ? 'Vencida' : dias === 0 ? 'Vence hoje' : 'Urgente',
      badgeBg: '#fee2e2',
      badgeColor: '#991b1b',
      rowBg: '#fff7f7'
    };
  }
  if (Number.isFinite(dias) && dias <= 3) {
    return {
      label: 'Atenção',
      badgeBg: '#fef3c7',
      badgeColor: '#92400e',
      rowBg: '#fffdf4'
    };
  }
  return {
    label: 'Monitorar',
    badgeBg: '#dbeafe',
    badgeColor: '#1d4ed8',
    rowBg: '#f8fbff'
  };
}

function buildMonthlyDigestHtmlReport({ rows = [], monthKey = '', triggeredBy = '', qtdFornecedores = 0 } = {}) {
  if (!rows.length) {
    return `
      <div style="font-family:Arial,sans-serif;color:#0f172a">
        <h2 style="margin:0 0 12px">Resumo financeiro mensal</h2>
        <p style="margin:0">Nenhuma NF encontrada para o período analisado.</p>
      </div>
    `;
  }

  const urgentes = rows.filter((item) => Number.isFinite(Number(item?.diasParaPrimeiroVencimento)) && Number(item.diasParaPrimeiroVencimento) <= 1).length;
  const atencao = rows.filter((item) => Number.isFinite(Number(item?.diasParaPrimeiroVencimento)) && Number(item.diasParaPrimeiroVencimento) >= 2 && Number(item.diasParaPrimeiroVencimento) <= 3).length;
  const generatedAt = new Date();
  const generatedAtBr = `${String(generatedAt.getDate()).padStart(2, '0')}/${String(generatedAt.getMonth() + 1).padStart(2, '0')}/${generatedAt.getFullYear()} ${String(generatedAt.getHours()).padStart(2, '0')}:${String(generatedAt.getMinutes()).padStart(2, '0')}`;

  return `
    <div style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
      <div style="max-width:1180px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f172a 0%,#1e293b 65%,#334155 100%);color:#ffffff">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;margin-bottom:8px">Relatório visual financeiro</div>
          <div style="font-size:28px;font-weight:700;line-height:1.2">Resumo mensal de NFs com vencimento próximo</div>
          <div style="margin-top:10px;font-size:14px;opacity:.9">Mês de referência: ${escapeHtml(monthKey)} · Gerado em ${escapeHtml(generatedAtBr)} · Disparo: ${escapeHtml(normalizeText(triggeredBy) || 'sistema')}</div>
        </div>

        <div style="padding:22px 28px 6px;background:#ffffff">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border-spacing:12px 12px">
            <tr>
              <td style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:16px;padding:16px;vertical-align:top">
                <div style="font-size:12px;color:#1d4ed8;text-transform:uppercase;letter-spacing:.05em">Total de NFs</div>
                <div style="font-size:28px;font-weight:700;color:#0f172a;margin-top:6px">${rows.length}</div>
              </td>
              <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:16px;padding:16px;vertical-align:top">
                <div style="font-size:12px;color:#15803d;text-transform:uppercase;letter-spacing:.05em">Fornecedores</div>
                <div style="font-size:28px;font-weight:700;color:#0f172a;margin-top:6px">${qtdFornecedores}</div>
              </td>
              <td style="background:#fff7ed;border:1px solid #fed7aa;border-radius:16px;padding:16px;vertical-align:top">
                <div style="font-size:12px;color:#c2410c;text-transform:uppercase;letter-spacing:.05em">Urgentes</div>
                <div style="font-size:28px;font-weight:700;color:#0f172a;margin-top:6px">${urgentes}</div>
              </td>
              <td style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:16px;padding:16px;vertical-align:top">
                <div style="font-size:12px;color:#7c3aed;text-transform:uppercase;letter-spacing:.05em">Em atenção</div>
                <div style="font-size:28px;font-weight:700;color:#0f172a;margin-top:6px">${atencao}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="padding:0 28px 22px">
          <div style="display:inline-block;background:#f8fafc;border:1px solid #e2e8f0;border-radius:999px;padding:8px 14px;font-size:12px;color:#475569">
            Legenda: <span style="color:#991b1b;font-weight:700">Urgente</span> até 1 dia · <span style="color:#92400e;font-weight:700">Atenção</span> entre 2 e 3 dias · <span style="color:#1d4ed8;font-weight:700">Monitorar</span> acima de 3 dias
          </div>
        </div>

        <div style="padding:0 20px 24px">
          <div style="overflow-x:auto;border-top:1px solid #e2e8f0">
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;color:#0f172a">
              <thead>
                <tr style="background:#f8fafc">
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Status</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Fornecedor</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Empresa</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Destino</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">NF</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Série</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Entrada</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">1º vencimento</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Dias</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Status da NF</th>
                  <th align="left" style="padding:14px 12px;border-bottom:1px solid #e2e8f0">Agendamento</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map((item) => {
                  const theme = digestRowTheme(item);
                  return `
                    <tr style="background:${theme.rowBg}">
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">
                        <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${theme.badgeBg};color:${theme.badgeColor};font-weight:700;font-size:12px">${escapeHtml(theme.label)}</span>
                      </td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.fornecedor || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.empresa || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.destino || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700">${escapeHtml(item.numeroNf || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.serie || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.dataEntradaBr || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.dataPrimeiroVencimentoBr || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0;font-weight:700">${escapeHtml(item.diasParaPrimeiroVencimento == null ? '-' : item.diasParaPrimeiroVencimento)}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.statusRelatorio || '-')}</td>
                      <td style="padding:12px;border-bottom:1px solid #e2e8f0">${escapeHtml(item.agendamentoId || '-')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
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
  if (isRelatorioDbReadDisabled()) {
    throw new Error(`relatorio_db_read_disabled:${relatorioDbReadDisabledReason || 'cooldown_ativo'}`);
  }

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT rowHash, agendamentoId, ${quoteIdentifier('Fornecedor')} AS fornecedorRaw, ${quoteIdentifier('Nr. nota')} AS numeroNfRaw, ${quoteIdentifier('Série')} AS serieRaw, ${quoteIdentifier('Status')} AS statusRaw, ${quoteIdentifier('Data 1º vencimento')} AS vencimentoRaw, ${quoteIdentifier('Data de Entrada')} AS dataEntradaRaw, ${quoteIdentifier('Data do cadastro')} AS dataCadastroRaw, ${quoteIdentifier('Entrada')} AS entradaRaw, ${quoteIdentifier('Empresa')} AS empresaRaw, ${quoteIdentifier('Destino')} AS destinoRaw, dadosOriginaisJson FROM ${quoteIdentifier(TABLE_NAME)}`
    );
    relatorioDbReadDisabledAt = 0;
    relatorioDbReadDisabledReason = '';
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
  } catch (error) {
    if (isPrismaPanicLike(error)) {
      disableRelatorioDbReads(error, 'loadRelatorioRowsFromDb');
    }
    throw error;
  }
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
  if (!forceSend) {
    if (monthlyDigestInFlight) return monthlyDigestInFlight;
    if (lastMonthlyDigestCheckAt > 0 && (Date.now() - lastMonthlyDigestCheckAt) < MONTHLY_DIGEST_CHECK_COOLDOWN_MS) {
      return { sent: false, reason: 'Verificação mensal em cooldown.' };
    }
  }

  const runner = (async () => {
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
  const subject = `Resumo financeiro mensal: NFs com vencimento próximo (${monthKey})`;
  const text = [
    'Resumo mensal de notas com 1º vencimento próximo.',
    '',
    `Mês de referência: ${monthKey}`,
    `Disparo: ${normalizeText(triggeredBy) || 'sistema'}`,
    `Total de NFs: ${nearDue.length}`,
    `Total de fornecedores: ${qtdFornecedores}`,
    '',
    ...nearDue.map((item) => [
      `Fornecedor: ${item.fornecedor || '-'}`,
      `NF: ${item.numeroNf || '-'}${item.serie ? ` / Série ${item.serie}` : ''}`,
      `Status NF: ${item.statusRelatorio || '-'}`,
      `Destino: ${item.destino || '-'}`,
      `1º vencimento: ${item.dataPrimeiroVencimentoBr || '-'}`,
      `Dias para vencer: ${item.diasParaPrimeiroVencimento == null ? '-' : item.diasParaPrimeiroVencimento}`,
      `Agendamento: ${item.agendamentoId || '-'}`
    ].join(' | ')),
    '',
    'O detalhamento visual também segue no corpo do e-mail.'
  ].join('\n');
  const html = buildMonthlyDigestHtmlReport({
    rows: nearDue,
    monthKey,
    triggeredBy,
    qtdFornecedores
  });
  const sent = await sendMail({ to, subject, text, html });

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

    return { ...sent, totalNotas: nearDue.length, totalFornecedores: qtdFornecedores, formato: 'html_visual' };
  })();

  if (!forceSend) {
    monthlyDigestInFlight = runner
      .finally(() => {
        lastMonthlyDigestCheckAt = Date.now();
        monthlyDigestInFlight = null;
      });
    return monthlyDigestInFlight;
  }

  try {
    return await runner;
  } finally {
    lastMonthlyDigestCheckAt = Date.now();
  }
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
