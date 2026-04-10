import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { auditLog } from './audit.js';
import { readAgendamentos } from './file-store.js';
import { computeDueInfo, toIsoDate, formatDateBR } from './nf-monitoring.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const dataDir = path.resolve(backendRoot, 'data');
const uploadsDir = path.resolve(backendRoot, 'uploads');
const importDir = path.join(uploadsDir, 'importacao-relatorio');
const importDirCandidates = Array.from(new Set([
  importDir,
  path.resolve(backendRoot, '../uploads/importacao-relatorio'),
  path.resolve(backendRoot, '../../uploads/importacao-relatorio'),
  path.resolve(process.cwd(), 'uploads/importacao-relatorio'),
  path.resolve(process.cwd(), 'backend/uploads/importacao-relatorio'),
  path.resolve(process.cwd(), 'backend/backend/uploads/importacao-relatorio')
]));
const fallbackFile = path.join(dataDir, 'fornecedores-pendentes.json');
const rawFallbackFile = path.join(dataDir, 'relatorio-terceirizado-raw.json');
const stateFile = path.join(dataDir, 'importacao-relatorio-state.json');

const SUPPORTED_EXTENSIONS = new Set(['.ods', '.csv', '.json', '.xlsx']);
const TABLE_NAME = 'RelatorioTerceirizado';
const WATCH_INTERVAL_MS = 60 * 1000;
const RELATORIO_IMPORT_VERSION = '2026-04-10-v2';


const DATE_COLUMNS = new Set([
  'Data emissão',
  'Data de Entrada',
  'Data 1º vencimento',
  'Data do cadastro',
  'Data de emissão do CT-e',
  'Data de entrada do CT-e'
]);

const COLUMN_ALIASES = {
  destino: 'Destino',
  'ISSQN retido': 'ISSQN retido',
  'ISSQN retido2': 'ISSQN retido2'
};

const SHEET_COLUMNS = [...new Set([
  'Entrada',
  'Fornecedor',
  'Nr. nota',
  'Série',
  'Data emissão',
  'Data de Entrada',
  'Data 1º vencimento',
  'Tipo custo entrada',
  'Valor da nota',
  'Valor desconto',
  'Qtd. itens',
  'Valor produtos',
  'Total frete',
  'Volume total',
  'Peso total',
  'Outras desp.',
  'Total entradas',
  'Status',
  'Prazo médio',
  'Empresa',
  'Data do cadastro',
  'Total de IPI',
  'Base de ICMS',
  'Total ICMS',
  'Desp. extras',
  'Desp. extr. mad.',
  'Frete conhec.',
  'Desp. financ.',
  'Base de ST',
  'Total ST',
  'DARE guia',
  'DARE antecip.',
  'DARE 1566',
  'Serviços',
  'ISSQN',
  'Valor apropriar',
  'Valor custo oper.',
  'ISSQN retido',
  'Valor ICMS diferido',
  'Base FCP',
  'Valor FCP',
  'Base FCP ST',
  'Valor FCP ST',
  'Valor FEEF - MT',
  'ICMS desonerado',
  'ICMS descontado PIS/COFINS',
  'CFOP',
  'PIS retido',
  'COFINS retida',
  'INSS retido',
  'IRRF retido',
  'CSLL retido',
  'ISSQN retido2',
  'Número do CT-e',
  'Transportadora',
  'Data de emissão do CT-e',
  'Valor do CT-e',
  'Data de entrada do CT-e',
  'Identificação NF-e',
  'Identificação CT-e/NF-e principal',
  'Identificação CT-e/NF-e auxiliar',
  'Fornecedor substituto tributário',
  'Destino'
])];

let watcherHandle = null;
let watcherBusy = false;
let relatorioDbDisabled = false;
let relatorioDbDisableReason = null;
let relatorioImportPromise = null;
let relatorioTableColumnsCache = null;

function disableRelatorioDb(error, context = 'operacao_desconhecida') {
  relatorioDbDisabled = true;
  const detail = error?.message || String(error || 'erro_desconhecido');
  relatorioDbDisableReason = `${context}: ${detail}`;
  console.error(`[RELATORIO_DB_FALLBACK] Banco desabilitado para o relatório terceirizado. Motivo: ${relatorioDbDisableReason}`);
}

function pathToDisplayName(filePathOrName) {
  if (Buffer.isBuffer(filePathOrName)) {
    const utf8 = filePathOrName.toString('utf8');
    if (!utf8.includes('�')) return utf8;
    return filePathOrName.toString('latin1');
  }
  return String(filePathOrName || '');
}

function joinBufferPath(dir, name) {
  return Buffer.concat([
    Buffer.from(String(dir)),
    Buffer.from('/'),
    Buffer.isBuffer(name) ? name : Buffer.from(String(name || ''))
  ]);
}

function extnameSafe(filePathOrName) {
  const display = pathToDisplayName(filePathOrName);
  const ext = path.extname(display).toLowerCase();
  if (ext) return ext;
  const bytes = Buffer.isBuffer(filePathOrName) ? filePathOrName : Buffer.from(String(filePathOrName || ''));
  return path.extname(bytes.toString('latin1')).toLowerCase();
}

function buildFileKey(name, stats = {}) {
  return `${RELATORIO_IMPORT_VERSION}:${pathToDisplayName(name)}:${Number(stats?.mtimeMs || 0)}:${Number(stats?.size || 0)}`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function quoteIdentifier(value = '') {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function xmlUnescape(value = '') {
  return String(value || '')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function trimTrailingEmpty(cells = []) {
  const output = [...cells];
  while (output.length && `${output[output.length - 1] ?? ''}`.trim() === '') output.pop();
  return output;
}

function normalizeCellValue(value) {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDateToBr(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  return `${day}/${month}/${year}`;
}

function excelSerialToDate(serial) {
  const num = Number(serial);
  if (!Number.isFinite(num) || num <= 0) return null;
  const utcDays = Math.floor(num - 25569);
  const utcValue = utcDays * 86400;
  const dateInfo = new Date(utcValue * 1000);
  if (Number.isNaN(dateInfo.getTime())) return null;
  return new Date(dateInfo.getUTCFullYear(), dateInfo.getUTCMonth(), dateInfo.getUTCDate());
}

function normalizeSpreadsheetValueByColumn(column = '', value = '') {
  if (value instanceof Date) return DATE_COLUMNS.has(column) ? formatDateToBr(value) : normalizeCellValue(value.toISOString());
  const normalized = normalizeCellValue(value);
  if (!DATE_COLUMNS.has(column)) return normalized;
  if (!normalized) return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(normalized) || /^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const converted = excelSerialToDate(Number(normalized));
    if (converted) return formatDateToBr(converted);
  }
  return normalized;
}

function makeUniqueHeaders(headers = []) {
  const seen = new Map();
  return headers.map((header) => {
    const baseRaw = normalizeCellValue(header);
    if (!baseRaw) return '';
    const canonicalBase = COLUMN_ALIASES[baseRaw] || baseRaw;
    const count = (seen.get(canonicalBase) || 0) + 1;
    seen.set(canonicalBase, count);
    if (count === 1) return canonicalBase;
    if (canonicalBase === 'ISSQN retido' && count === 2) return 'ISSQN retido2';
    return `${canonicalBase} ${count}`;
  });
}

function getCaseInsensitiveValue(row = {}, expectedColumn = '') {
  const direct = row?.[expectedColumn];
  if (direct !== undefined && direct !== null) return direct;
  const target = normalizeCellValue(expectedColumn).toLowerCase();
  for (const [key, value] of Object.entries(row || {})) {
    const normalizedKey = normalizeCellValue(key);
    const canonicalKey = COLUMN_ALIASES[normalizedKey] || normalizedKey;
    if (canonicalKey.toLowerCase() === target) return value;
  }
  return '';
}

function pickSpreadsheetValue(row = {}, expectedColumn = '') {
  const value = getCaseInsensitiveValue(row, expectedColumn);
  if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  if (expectedColumn === 'Destino') return getCaseInsensitiveValue(row, 'destino');
  return '';
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = normalizeCellValue(value);
  if (!raw) return 0;

  if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }

  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function toFixedNumber(value, decimals = 3) {
  return Number(Number(value || 0).toFixed(decimals));
}

function buildRowHash(row = {}) {
  const payload = SHEET_COLUMNS.map((column) => normalizeCellValue(row[column] ?? '')).join('|');
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function buildNoteObservation(row = {}) {
  const parts = [];
  if (row['Entrada']) parts.push(`Entrada ${row['Entrada']}`);
  if (row['Data emissão']) parts.push(`Emissão ${row['Data emissão']}`);
  if (row['Data de Entrada']) parts.push(`Entrada ${row['Data de Entrada']}`);
  if (row['Status']) parts.push(`Status ${row['Status']}`);
  if (row['Data 1º vencimento']) parts.push(`1º vencimento ${row['Data 1º vencimento']}`);
  return parts.join(' | ');
}

function buildDueFields(dateValue = '') {
  const dueInfo = computeDueInfo({ dueDateValue: dateValue });
  return {
    dataPrimeiroVencimento: dueInfo.dueDateIso ? toIsoDate(dueInfo.dueDateIso) : '',
    dataPrimeiroVencimentoBr: dueInfo.dueDateBr || '',
    diasParaPrimeiroVencimento: dueInfo.daysUntilDue,
    alertaVencimentoProximo: dueInfo.nearDue,
    tooltipVencimento: dueInfo.tooltip || (dueInfo.dueDate ? `1º vencimento em ${formatDateBR(dueInfo.dueDate)}` : '')
  };
}

function normalizeSpreadsheetRow(row = {}) {
  const normalized = {};
  for (const column of SHEET_COLUMNS) {
    normalized[column] = normalizeSpreadsheetValueByColumn(column, pickSpreadsheetValue(row, column));
  }
  return normalized;
}

function filterValidRows(rows = []) {
  return rows
    .map(normalizeSpreadsheetRow)
    .filter((row) => row['Fornecedor'] && row['Nr. nota']);
}

function normalizeImportedItems(rows = []) {
  const groups = new Map();

  for (const row of rows) {
    const normalizedRow = normalizeSpreadsheetRow(row);
    const fornecedor = normalizeCellValue(normalizedRow['Fornecedor']);
    const numeroNf = normalizeCellValue(normalizedRow['Nr. nota']);
    if (!fornecedor || !numeroNf) continue;

    if (!groups.has(fornecedor)) {
      groups.set(fornecedor, {
        id: groups.size + 1,
        fornecedor,
        transportadora: normalizeCellValue(normalizedRow['Transportadora']) || null,
        notas: [],
        notasFiscais: [],
        quantidadeNotas: 0,
        quantidadeVolumes: 0,
        quantidadeItens: 0,
        pesoTotalKg: 0,
        valorTotalNf: 0,
        totalNotasVencimentoProximo: 0,
        possuiVencimentoProximo: false,
        status: 'AGUARDANDO_CHEGADA',
        statusRelatorio: 'Aguardando Chegada',
        _seenNotaKeys: new Set()
      });
    }

    const current = groups.get(fornecedor);
    const dueFields = buildDueFields(normalizedRow['Data 1º vencimento']);
    const isManualNote = normalizeCellValue(normalizedRow['Entrada']).toUpperCase() === 'MANUAL'
      || normalizeCellValue(normalizedRow['Status']).toUpperCase().includes('MANUAL');
    const note = {
      rowHash: normalizeCellValue(row?.rowHash || '') || buildRowHash(normalizedRow),
      numeroNf,
      serie: normalizeCellValue(normalizedRow['Série']),
      empresa: normalizeCellValue(normalizedRow['Empresa']),
      destino: normalizeCellValue(normalizedRow['Destino']),
      dataEntrada: normalizeCellValue(normalizedRow['Data de Entrada']),
      entrada: normalizeCellValue(normalizedRow['Entrada']),
      volumes: toFixedNumber(parseNumber(normalizedRow['Volume total']), 3),
      quantidadeItens: Math.max(0, Math.trunc(parseNumber(normalizedRow['Qtd. itens']))),
      peso: toFixedNumber(parseNumber(normalizedRow['Peso total']), 3),
      valorNf: toFixedNumber(parseNumber(normalizedRow['Valor da nota']), 2),
      quantidadeItens: toFixedNumber(parseNumber(normalizedRow['Qtd. itens']), 0),
      observacao: buildNoteObservation(normalizedRow),
      origemManual: isManualNote,
      inseridaManual: isManualNote,
      preLancamentoPendente: isManualNote,
      disponivelNoRelatorio: !isManualNote,
      ...dueFields,
      tooltipVencimento: isManualNote
        ? 'NF inserida manualmente; sem pré-lançamento no relatório terceirizado.'
        : dueFields.tooltipVencimento
    };

    const noteKey = note.rowHash || `${note.numeroNf}::${note.serie}::${note.valorNf}::${note.peso}::${note.volumes}`;
    if (!noteKey || current._seenNotaKeys.has(noteKey)) continue;
    current._seenNotaKeys.add(noteKey);

    current.notas.push(note);
    current.notasFiscais = current.notas;
    current.quantidadeNotas += 1;
    current.quantidadeVolumes = toFixedNumber(current.quantidadeVolumes + Number(note.volumes || 0), 3);
    current.quantidadeItens = Math.max(0, Number(current.quantidadeItens || 0) + Number(note.quantidadeItens || 0));
    current.pesoTotalKg = toFixedNumber(current.pesoTotalKg + Number(note.peso || 0), 3);
    current.valorTotalNf = toFixedNumber(current.valorTotalNf + Number(note.valorNf || 0), 2);
    if (dueFields.alertaVencimentoProximo) {
      current.totalNotasVencimentoProximo += 1;
      current.possuiVencimentoProximo = true;
    }
  }

  return [...groups.values()]
    .map((item) => {
      delete item._seenNotaKeys;
      item.notas = [...item.notas].sort((a, b) => {
        if (!!a.alertaVencimentoProximo !== !!b.alertaVencimentoProximo) {
          return a.alertaVencimentoProximo ? -1 : 1;
        }
        const dueA = a.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(a.diasParaPrimeiroVencimento);
        const dueB = b.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(b.diasParaPrimeiroVencimento);
        if (dueA !== dueB) return dueA - dueB;
        return String(a.numeroNf || '').localeCompare(String(b.numeroNf || ''), 'pt-BR');
      });
      item.notasFiscais = item.notas;
      return item;
    })
    .sort((a, b) => {
      if (!!a.possuiVencimentoProximo !== !!b.possuiVencimentoProximo) {
        return a.possuiVencimentoProximo ? -1 : 1;
      }
      if (Number(a.totalNotasVencimentoProximo || 0) !== Number(b.totalNotasVencimentoProximo || 0)) {
        return Number(b.totalNotasVencimentoProximo || 0) - Number(a.totalNotasVencimentoProximo || 0);
      }
      return String(a.fornecedor || '').localeCompare(String(b.fornecedor || ''), 'pt-BR');
    });
}

function buildPendingNoteKey(nota = {}) {
  const rowHash = normalizeCellValue(nota?.rowHash || '');
  if (rowHash) return rowHash;
  const numeroNf = normalizeCellValue(nota?.numeroNf || nota?.numero_nf || '');
  const serie = normalizeCellValue(nota?.serie || '');
  if (!numeroNf) return '';
  return `${numeroNf}::${serie}`;
}

function filterScheduledNotesFromGroups(groups = []) {
  const rescheduleStatuses = new Set(['CANCELADO', 'REPROVADO', 'NO_SHOW']);
  const blockedKeys = new Set();

  for (const agendamento of readAgendamentos()) {
    if (rescheduleStatuses.has(String(agendamento?.status || '').trim().toUpperCase())) continue;
    const notas = Array.isArray(agendamento?.notasFiscais) ? agendamento.notasFiscais : Array.isArray(agendamento?.notas) ? agendamento.notas : [];
    for (const nota of notas) {
      const key = buildPendingNoteKey(nota);
      if (key) blockedKeys.add(key);
    }
  }

  return (Array.isArray(groups) ? groups : []).map((group, index) => {
    const notas = (Array.isArray(group?.notas) ? group.notas : Array.isArray(group?.notasFiscais) ? group.notasFiscais : [])
      .filter((nota) => {
        const key = buildPendingNoteKey(nota);
        return !key || !blockedKeys.has(key);
      })
      .sort((a, b) => {
        if (!!a.alertaVencimentoProximo !== !!b.alertaVencimentoProximo) {
          return a.alertaVencimentoProximo ? -1 : 1;
        }
        const dueA = a.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(a.diasParaPrimeiroVencimento);
        const dueB = b.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(b.diasParaPrimeiroVencimento);
        if (dueA !== dueB) return dueA - dueB;
        return String(a.numeroNf || '').localeCompare(String(b.numeroNf || ''), 'pt-BR');
      });

    if (!notas.length) return null;

    const quantidadeVolumes = toFixedNumber(notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0), 3);
    const pesoTotalKg = toFixedNumber(notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0), 3);
    const valorTotalNf = toFixedNumber(notas.reduce((acc, nota) => acc + Number(nota?.valorNf || 0), 0), 2);
    const totalNotasVencimentoProximo = notas.filter((nota) => nota?.alertaVencimentoProximo).length;

    return {
      ...group,
      id: group?.id || index + 1,
      notas,
      notasFiscais: notas,
      quantidadeNotas: notas.length,
      quantidadeVolumes,
      pesoTotalKg,
      valorTotalNf,
      totalNotasVencimentoProximo,
      possuiVencimentoProximo: totalNotasVencimentoProximo > 0
    };
  }).filter(Boolean).sort((a, b) => {
    if (!!a.possuiVencimentoProximo !== !!b.possuiVencimentoProximo) {
      return a.possuiVencimentoProximo ? -1 : 1;
    }
    if (Number(a.totalNotasVencimentoProximo || 0) !== Number(b.totalNotasVencimentoProximo || 0)) {
      return Number(b.totalNotasVencimentoProximo || 0) - Number(a.totalNotasVencimentoProximo || 0);
    }
    return String(a.fornecedor || '').localeCompare(String(b.fornecedor || ''), 'pt-BR');
  });
}

function normalizeSelectedNota(nota = {}) {
  return {
    rowHash: normalizeCellValue(nota?.rowHash || ''),
    numeroNf: normalizeCellValue(nota?.numeroNf || nota?.numero_nf || ''),
    serie: normalizeCellValue(nota?.serie || ''),
    empresa: normalizeCellValue(nota?.empresa || ''),
    destino: normalizeCellValue(nota?.destino || ''),
    dataEntrada: normalizeCellValue(nota?.dataEntrada || ''),
    entrada: normalizeCellValue(nota?.entrada || ''),
    chaveAcesso: normalizeCellValue(nota?.chaveAcesso || ''),
    volumes: toFixedNumber(parseNumber(nota?.volumes || 0), 3),
    peso: toFixedNumber(parseNumber(nota?.peso || 0), 3),
    valorNf: toFixedNumber(parseNumber(nota?.valorNf || 0), 2),
    quantidadeItens: toFixedNumber(parseNumber(nota?.quantidadeItens || 0), 0),
    observacao: normalizeCellValue(nota?.observacao || '')
  };
}

function normalizeNoteFromSpreadsheetRow(row = {}) {
  const normalizedRow = normalizeSpreadsheetRow(row);
  return {
    rowHash: normalizeCellValue(row?.rowHash || '') || buildRowHash(normalizedRow),
    numeroNf: normalizeCellValue(normalizedRow['Nr. nota']),
    serie: normalizeCellValue(normalizedRow['Série']),
    empresa: normalizeCellValue(normalizedRow['Empresa']),
    destino: normalizeCellValue(normalizedRow['Destino']),
    dataEntrada: normalizeCellValue(normalizedRow['Data de Entrada']),
    entrada: normalizeCellValue(normalizedRow['Entrada']),
    chaveAcesso: '',
    volumes: toFixedNumber(parseNumber(normalizedRow['Volume total']), 3),
    peso: toFixedNumber(parseNumber(normalizedRow['Peso total']), 3),
    valorNf: toFixedNumber(parseNumber(normalizedRow['Valor da nota']), 2),
    quantidadeItens: toFixedNumber(parseNumber(normalizedRow['Qtd. itens']), 0),
    observacao: buildNoteObservation(normalizedRow),
    ...buildDueFields(normalizedRow['Data 1º vencimento'])
  };
}

export async function canonicalizeNotasSelecionadasComRelatorio(fornecedor, notas = []) {
  const normalizedSelection = Array.isArray(notas) ? notas.map(normalizeSelectedNota).filter((nota) => nota.numeroNf || nota.rowHash) : [];
  if (!normalizedSelection.length) return [];

  try {
    await ensureRelatorioTable();

    const rowHashes = [...new Set(normalizedSelection.map((nota) => nota.rowHash).filter(Boolean))];
    const byHash = new Map();

    if (rowHashes.length) {
      const placeholders = rowHashes.map(() => '?').join(', ');
      const rows = await prisma.$queryRawUnsafe(
        `SELECT rowHash, dadosOriginaisJson FROM ${quoteIdentifier(TABLE_NAME)} WHERE rowHash IN (${placeholders})`,
        ...rowHashes
      );

      for (const row of rows || []) {
        try {
          const parsed = row?.dadosOriginaisJson ? JSON.parse(String(row.dadosOriginaisJson)) : {};
          byHash.set(String(row.rowHash || ''), normalizeNoteFromSpreadsheetRow({ ...parsed, rowHash: row.rowHash }));
        } catch {}
      }
    }

    const fornecedorNormalized = normalizeCellValue(fornecedor);
    return normalizedSelection.map((nota) => {
      const fromHash = nota.rowHash ? byHash.get(nota.rowHash) : null;
      if (fromHash) return { ...fromHash, chaveAcesso: nota.chaveAcesso || fromHash.chaveAcesso || '' };

      return {
        ...nota,
        fornecedor: fornecedorNormalized
      };
    });
  } catch {
    return normalizedSelection;
  }
}


function manualNotaRowHash(fornecedor = '', nota = {}) {
  const key = [
    'MANUAL',
    normalizeCellValue(fornecedor),
    normalizeCellValue(nota?.numeroNf || ''),
    normalizeCellValue(nota?.serie || ''),
    normalizeCellValue(nota?.destino || ''),
    toFixedNumber(parseNumber(nota?.volumes || 0), 3),
    toFixedNumber(parseNumber(nota?.peso || 0), 3)
  ].join('|');
  return crypto.createHash('sha256').update(key).digest('hex');
}

function buildManualSpreadsheetRow(fornecedor = '', nota = {}, actor = null) {
  const row = {};
  for (const column of SHEET_COLUMNS) row[column] = '';
  row['Entrada'] = 'MANUAL';
  row['Fornecedor'] = normalizeCellValue(fornecedor);
  row['Nr. nota'] = normalizeCellValue(nota?.numeroNf || '');
  row['Série'] = normalizeCellValue(nota?.serie || '');
  row['Volume total'] = String(toFixedNumber(parseNumber(nota?.volumes || 0), 3));
  row['Peso total'] = String(toFixedNumber(parseNumber(nota?.peso || 0), 3));
  row['Destino'] = normalizeCellValue(nota?.destino || '');
  row['Qtd. itens'] = String(toFixedNumber(parseNumber(nota?.quantidadeItens || 0), 0));
  row['Status'] = 'NF INSERIDA MANUALMENTE';
  row['Empresa'] = normalizeCellValue(nota?.empresa || nota?.destino || '');
  row['Data do cadastro'] = new Date().toISOString();
  const operador = normalizeCellValue(actor?.nome || actor?.name || actor?.email || actor?.sub || '');
  row['Prazo médio'] = operador ? `Operador: ${operador}` : '';
  row.rowHash = manualNotaRowHash(fornecedor, nota);
  return row;
}

function readFallbackGroups() {
  try {
    if (!fs.existsSync(fallbackFile)) return [];
    return JSON.parse(fs.readFileSync(fallbackFile, 'utf8')) || [];
  } catch {
    return [];
  }
}

function upsertManualNotaIntoFallback(fornecedor = '', nota = {}) {
  const currentGroups = readFallbackGroups();
  const groups = Array.isArray(currentGroups) ? currentGroups : [];
  const fornecedorNormalized = normalizeCellValue(fornecedor);
  const notaNormalizada = normalizeSelectedNota({
    ...nota,
    rowHash: manualNotaRowHash(fornecedorNormalized, nota),
    empresa: nota?.empresa || nota?.destino || '',
    observacao: nota?.observacao || 'NF inserida manualmente - sem pré-lançamento',
    origemManual: true,
    inseridaManual: true,
    preLancamentoPendente: true,
    disponivelNoRelatorio: false,
    tooltipVencimento: 'NF inserida manualmente; sem pré-lançamento no relatório terceirizado.'
  });

  const existingGroup = groups.find((item) => normalizeCellValue(item?.fornecedor || item?.nome || '') === fornecedorNormalized);
  const targetGroup = existingGroup || { id: fornecedorNormalized || `manual-${Date.now()}`, fornecedor: fornecedorNormalized, nome: fornecedorNormalized, notas: [], notasFiscais: [] };
  const notasAtuais = Array.isArray(targetGroup.notas) ? targetGroup.notas : Array.isArray(targetGroup.notasFiscais) ? targetGroup.notasFiscais : [];
  const duplicate = notasAtuais.some((item) => normalizeCellValue(item?.numeroNf || '') === notaNormalizada.numeroNf && normalizeCellValue(item?.serie || '') === notaNormalizada.serie);
  if (duplicate) {
    throw new Error('Esta NF manual já está cadastrada para este fornecedor.');
  }

  const notas = [...notasAtuais, notaNormalizada];
  targetGroup.fornecedor = fornecedorNormalized;
  targetGroup.nome = fornecedorNormalized;
  targetGroup.notas = notas;
  targetGroup.notasFiscais = notas;
  targetGroup.quantidadeNotas = notas.length;
  targetGroup.quantidadeVolumes = Number(notas.reduce((acc, item) => acc + Number(item?.volumes || 0), 0).toFixed(3));
  targetGroup.pesoTotalKg = Number(notas.reduce((acc, item) => acc + Number(item?.peso || 0), 0).toFixed(3));
  targetGroup.valorTotalNf = Number(notas.reduce((acc, item) => acc + Number(item?.valorNf || 0), 0).toFixed(2));
  targetGroup.updatedAt = new Date().toISOString();
  if (!existingGroup) {
    targetGroup.createdAt = targetGroup.updatedAt;
    groups.unshift(targetGroup);
  }

  writeFallback(groups);
  return notaNormalizada;
}

export async function persistManualPendingNota({ fornecedor = '', nota = {}, actor = null } = {}) {
  const fornecedorNormalized = normalizeCellValue(fornecedor);
  const normalizedNota = normalizeSelectedNota({
    ...nota,
    empresa: nota?.empresa || nota?.destino || '',
    observacao: nota?.observacao || 'NF inserida manualmente - sem pré-lançamento',
    origemManual: true,
    inseridaManual: true,
    preLancamentoPendente: true,
    disponivelNoRelatorio: false,
    tooltipVencimento: 'NF inserida manualmente; sem pré-lançamento no relatório terceirizado.'
  });
  normalizedNota.rowHash = manualNotaRowHash(fornecedorNormalized, normalizedNota);

  try {
    if (await ensureRelatorioTable()) {
      const duplicateRows = await prisma.$queryRawUnsafe(
        `SELECT rowHash
           FROM ${quoteIdentifier(TABLE_NAME)}
          WHERE agendamentoId IS NULL
            AND LOWER(TRIM(${quoteIdentifier('Fornecedor')})) = LOWER(?)
            AND TRIM(${quoteIdentifier('Nr. nota')}) = ?
            AND COALESCE(TRIM(${quoteIdentifier('Série')}), '') = ?
          LIMIT 1`,
        fornecedorNormalized,
        normalizedNota.numeroNf,
        normalizedNota.serie
      );

      if (Array.isArray(duplicateRows) && duplicateRows.length) {
        throw new Error('Esta NF manual já está cadastrada para este fornecedor.');
      }

      const row = buildManualSpreadsheetRow(fornecedorNormalized, normalizedNota, actor);
      const columns = ['rowHash', 'agendamentoId', ...SHEET_COLUMNS, 'origemArquivo', 'dadosOriginaisJson'];
      const values = [
        row.rowHash,
        null,
        ...SHEET_COLUMNS.map((column) => row[column] ?? ''),
        'manual-ui',
        JSON.stringify(row)
      ];
      const filtered = await filterColumnsForRelatorioInsert(columns, values);
      const placeholders = filtered.columns.map(() => '?').join(', ');
      await prisma.$executeRawUnsafe(
        `INSERT INTO ${quoteIdentifier(TABLE_NAME)} (${filtered.columns.map((column) => quoteIdentifier(column)).join(', ')}) VALUES (${placeholders})`,
        ...filtered.values
      );
    }
  } catch (error) {
    if (String(error?.message || '').includes('já está cadastrada')) {
      throw error;
    }
    if (!relatorioDbDisabled) {
      console.error('[RELATORIO_IMPORT] Falha ao persistir NF manual no banco, aplicando fallback em arquivo:', error?.message || error);
    }
  }

  return upsertManualNotaIntoFallback(fornecedorNormalized, normalizedNota);
}

function parseCsvLine(line = '', delimiter = ';') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((value) => value.trim());
}

function parseCsv(content = '') {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = makeUniqueHeaders(parseCsvLine(lines[0], delimiter));

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      if (header) row[header] = cols[index] ?? '';
    });
    return row;
  });
}

function parseJsonFile(content = '') {
  const parsed = JSON.parse(String(content || '[]'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.items)) return parsed.items;
  return [];
}

function getAttr(attrs = '', name = '') {
  const regex = new RegExp(`${name}="([^"]*)"`, 'i');
  return regex.exec(attrs)?.[1] ?? '';
}

function cellTextFromXml(inner = '') {
  return xmlUnescape(
    String(inner || '')
      .replace(/<text:line-break\s*\/\s*>/gi, '\n')
      .replace(/<text:s(?:[^>]*?text:c="(\d+)")?\s*\/\s*>/gi, (_m, count) => ' '.repeat(Number(count || 1)))
      .replace(/<[^>]+>/g, '')
  ).trim();
}

function parseOdsContentXml(contentXml = '') {
  const tableMatch = contentXml.match(/<table:table\b[\s\S]*?<\/table:table>/i);
  if (!tableMatch) return [];

  const tableXml = tableMatch[0];
  const rowRegex = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gi;
  const rows = [];
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableXml))) {
    const repeatRows = Number(getAttr(rowMatch[1], 'table:number-rows-repeated') || 1);
    const rowInner = rowMatch[2] || '';
    const cellRegex = /<table:(table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:\1>)/gi;
    const cells = [];
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowInner))) {
      const type = cellMatch[1];
      const attrs = cellMatch[2] || '';
      const inner = cellMatch[3] || '';
      const repeatCols = Number(getAttr(attrs, 'table:number-columns-repeated') || 1);
      let value = '';

      if (type !== 'covered-table-cell') {
        value = getAttr(attrs, 'office:string-value')
          || getAttr(attrs, 'office:date-value')
          || getAttr(attrs, 'office:value')
          || cellTextFromXml(inner)
          || '';
      }

      for (let i = 0; i < repeatCols; i += 1) cells.push(value);
    }

    const rowValues = trimTrailingEmpty(cells).map(normalizeCellValue);
    for (let i = 0; i < repeatRows; i += 1) rows.push([...rowValues]);
  }

  const headerIndex = rows.findIndex((row) => row.some((cell) => cell === 'Fornecedor') && row.some((cell) => cell.includes('Nr. nota')));
  if (headerIndex < 0) return [];

  const headers = makeUniqueHeaders(rows[headerIndex]);
  return rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => normalizeCellValue(cell) !== ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        if (header) item[header] = row[index] ?? '';
      });
      return item;
    });
}

function readZipEntry(filePath, entryName) {
  const buffer = fs.readFileSync(filePath);
  let eocd = -1;

  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }

  if (eocd < 0) throw new Error('Estrutura ZIP inválida.');

  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('Diretório central ZIP inválido.');

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    offset += 46 + fileNameLength + extraLength + commentLength;

    if (fileName !== entryName) continue;
    if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error('Cabeçalho local ZIP inválido.');

    const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = buffer.slice(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) return compressedData;
    if (compressionMethod === 8) return zlib.inflateRawSync(compressedData);
    throw new Error(`Compressão ZIP não suportada: ${compressionMethod}`);
  }

  throw new Error(`Arquivo ${entryName} não encontrado no ZIP.`);
}

function xlsxColumnToIndex(ref = '') {
  const letters = String(ref || '').match(/[A-Z]+/i)?.[0] || '';
  let value = 0;
  for (const char of letters.toUpperCase()) value = (value * 26) + (char.charCodeAt(0) - 64);
  return Math.max(0, value - 1);
}

function isLikelyXlsxDateFormat(formatCode = '', numFmtId = null) {
  const builtInDateFormats = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  if (builtInDateFormats.has(Number(numFmtId))) return true;
  const normalized = String(formatCode || '')
    .replace(/\./g, '')
    .replace(/\[[^\]]+\]/g, '')
    .replace(/"[^"]*"/g, '')
    .toLowerCase();
  return /(^|[^a-z])(d|dd|ddd|dddd|m|mm|mmm|mmmm|yy|yyyy|h|hh|s|ss)([^a-z]|$)/.test(normalized);
}

function parseXlsxStyles(xml = '') {
  const customFormats = new Map();
  for (const match of String(xml || '').matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/gi)) {
    customFormats.set(Number(match[1]), xmlUnescape(match[2] || ''));
  }

  const cellXfsMatch = String(xml || '').match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/i);
  const xfMatches = cellXfsMatch?.[1]?.match(/<xf[^>]*\/>/gi) || [];
  return xfMatches.map((xfXml) => {
    const numFmtId = Number(xfXml.match(/numFmtId="(\d+)"/i)?.[1] || 0);
    const formatCode = customFormats.get(numFmtId) || '';
    return {
      numFmtId,
      formatCode,
      isDate: isLikelyXlsxDateFormat(formatCode, numFmtId)
    };
  });
}

function excelSerialToIsoDate(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return String(value || '');
  const wholeDays = Math.floor(serial);
  const utc = Date.UTC(1899, 11, 30) + (wholeDays * 86400000);
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return String(value || '');
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseXlsxSharedStrings(xml = '') {
  const items = [];
  const matches = String(xml || '').match(/<si\b[\s\S]*?<\/si>/g) || [];
  for (const entry of matches) {
    const parts = [...entry.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1] || ''));
    items.push(parts.join(''));
  }
  return items;
}

function readOptionalZipEntry(filePath, entryName) {
  try {
    return readZipEntry(filePath, entryName);
  } catch {
    return null;
  }
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveFirstXlsxSheetPath(filePath) {
  const workbookXml = readOptionalZipEntry(filePath, 'xl/workbook.xml')?.toString('utf8') || '';
  const relsXml = readOptionalZipEntry(filePath, 'xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
  const firstSheetId = workbookXml.match(/<sheet[^>]*r:id="([^"]+)"/i)?.[1] || '';
  const relationPattern = new RegExp(`<Relationship[^>]*Id="${escapeRegex(firstSheetId)}"[^>]*Target="([^"]+)"`, 'i');
  const target = relsXml.match(relationPattern)?.[1] || 'worksheets/sheet1.xml';
  return target.startsWith('xl/') ? target : `xl/${target.replace(/^\/+/, '')}`;
}

function extractXlsxCellValue(cellXml = '', sharedStrings = [], styles = []) {
  const type = cellXml.match(/\bt="([^"]+)"/i)?.[1] || '';
  if (type === 'inlineStr') {
    const parts = [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlUnescape(match[1] || ''));
    return parts.join('');
  }
  const raw = xmlUnescape(cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '');
  if (type === 's') {
    const index = Number(raw || 0);
    return Number.isFinite(index) ? String(sharedStrings[index] ?? '') : '';
  }
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE';
  const styleIndex = Number(cellXml.match(/\bs="(\d+)"/i)?.[1] || 0);
  const style = Array.isArray(styles) ? styles[styleIndex] : null;
  if (style?.isDate && raw !== '' && Number.isFinite(Number(raw))) return excelSerialToIsoDate(raw);
  return raw;
}

function parseXlsxSheetXml(xml = '', sharedStrings = [], styles = []) {
  const rows = [];
  const rowMatches = String(xml || '').match(/<row\b[\s\S]*?<\/row>/g) || [];
  let headers = [];

  for (const rowXml of rowMatches) {
    const cells = [];
    const cellMatches = rowXml.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    for (const cellXml of cellMatches) {
      const ref = cellXml.match(/\br="([A-Z]+\d+)"/i)?.[1] || '';
      const index = xlsxColumnToIndex(ref);
      cells[index] = extractXlsxCellValue(cellXml, sharedStrings, styles);
    }
    const dense = trimTrailingEmpty(cells.map((value) => normalizeCellValue(value)));
    if (!dense.length) continue;
    if (!headers.length) {
      headers = makeUniqueHeaders(dense);
      continue;
    }
    const row = {};
    headers.forEach((header, index) => {
      if (!header) return;
      row[header] = normalizeSpreadsheetValueByColumn(header, dense[index] ?? '');
    });
    rows.push(row);
  }

  return rows;
}

function parseXlsxFile(filePath) {
  const sharedStringsXml = readOptionalZipEntry(filePath, 'xl/sharedStrings.xml');
  const sharedStrings = sharedStringsXml ? parseXlsxSharedStrings(sharedStringsXml.toString('utf8')) : [];
  const stylesXml = readOptionalZipEntry(filePath, 'xl/styles.xml');
  const styles = stylesXml ? parseXlsxStyles(stylesXml.toString('utf8')) : [];
  const sheetPath = resolveFirstXlsxSheetPath(filePath);
  const sheetXml = readZipEntry(filePath, sheetPath).toString('utf8');
  return parseXlsxSheetXml(sheetXml, sharedStrings, styles);
}

function parseSpreadsheetFile(filePath) {
  const ext = extnameSafe(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Formato de planilha não suportado. Use .ods, .xlsx, .csv ou .json.');
  }

  if (ext === '.csv') return parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (ext === '.json') return parseJsonFile(fs.readFileSync(filePath, 'utf8'));
  if (ext === '.ods') {
    const xml = readZipEntry(filePath, 'content.xml').toString('utf8');
    return parseOdsContentXml(xml);
  }
  if (ext === '.xlsx') return parseXlsxFile(filePath);

  return [];
}


async function runSqlIgnoringDuplicateKeyName(sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (error) {
    const code = Number(error?.code || error?.meta?.code || 0);
    const message = String(error?.message || '');
    if (code === 1061 || message.includes('Duplicate key name')) return;
    throw error;
  }
}

async function runSqlIgnoringLegacyConstraint(sql) {
  try {
    await prisma.$executeRawUnsafe(sql);
  } catch (error) {
    const code = Number(error?.code || error?.meta?.code || 0);
    const message = String(error?.message || '');
    if (
      code === 1060 ||
      code === 1061 ||
      message.includes('Duplicate column name') ||
      message.includes('Duplicate key name') ||
      message.includes('Multiple primary key defined')
    ) {
      return;
    }
    throw error;
  }
}

function readState() {
  try {
    if (!fs.existsSync(stateFile)) return {};
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeState(state = {}) {
  ensureDir(dataDir);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function writeFallback(groups = []) {
  ensureDir(dataDir);
  fs.writeFileSync(fallbackFile, JSON.stringify(groups, null, 2), 'utf8');
}

function writeRawFallback(rows = []) {
  ensureDir(dataDir);
  fs.writeFileSync(rawFallbackFile, JSON.stringify(rows, null, 2), 'utf8');
}

function withRelatorioImportLock(task) {
  if (relatorioImportPromise) return relatorioImportPromise;

  relatorioImportPromise = (async () => {
    try {
      return await task();
    } finally {
      relatorioImportPromise = null;
    }
  })();

  return relatorioImportPromise;
}

function relatorioColumnDefinitions() {
  return {
    id: 'INT NOT NULL AUTO_INCREMENT PRIMARY KEY',
    rowHash: 'VARCHAR(64) NULL',
    agendamentoId: 'INT NULL',
    ...Object.fromEntries(SHEET_COLUMNS.map((column) => [column, 'TEXT NULL'])),
    origemArquivo: 'VARCHAR(255) NULL',
    importedAt: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
    updatedAt: 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    dadosOriginaisJson: 'LONGTEXT NULL'
  };
}

async function ensureRelatorioSchema() {
  const definitions = relatorioColumnDefinitions();
  const createColumnsSql = Object.entries(definitions)
    .map(([column, definition]) => `${quoteIdentifier(column)} ${definition}`)
    .join(',\n  ');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(TABLE_NAME)} (
      ${createColumnsSql}
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  let existingColumns = null;
  try {
    const rows = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
    existingColumns = new Set((rows || []).map((row) => String(row?.Field || row?.COLUMN_NAME || '').trim()).filter(Boolean));
  } catch (error) {
    throw error;
  }

  for (const [column, definition] of Object.entries(definitions)) {
    if (existingColumns.has(column)) continue;
    await runSqlIgnoringLegacyConstraint(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`);
  }

  await runSqlIgnoringDuplicateKeyName(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD UNIQUE KEY uk_relatorio_rowhash (${quoteIdentifier('rowHash')})`);
  await runSqlIgnoringDuplicateKeyName(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD KEY idx_relatorio_agendamento (${quoteIdentifier('agendamentoId')})`);
  await runSqlIgnoringDuplicateKeyName(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD KEY idx_relatorio_fornecedor (${quoteIdentifier('Fornecedor')}(191))`);
  await runSqlIgnoringDuplicateKeyName(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD KEY idx_relatorio_nf (${quoteIdentifier('Nr. nota')}(191))`);
  await runSqlIgnoringDuplicateKeyName(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD KEY idx_relatorio_status (${quoteIdentifier('Status')}(191))`);

  relatorioTableColumnsCache = null;
}

async function ensureRelatorioTable() {
  if (relatorioDbDisabled) return false;

  try {
    await ensureRelatorioSchema();
    await prisma.$queryRawUnsafe(
      `SELECT rowHash, agendamentoId, dadosOriginaisJson
         FROM ${quoteIdentifier(TABLE_NAME)}
        LIMIT 1`
    );
    await getRelatorioTableColumns();
    return true;
  } catch (error) {
    disableRelatorioDb(error, 'ensureRelatorioTable:readOnlyProbe');
    return false;
  }
}

async function getRelatorioTableColumns() {
  if (relatorioTableColumnsCache) return relatorioTableColumnsCache;
  const rows = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
  relatorioTableColumnsCache = new Set((rows || []).map((row) => String(row?.Field || row?.COLUMN_NAME || '').trim()).filter(Boolean));
  return relatorioTableColumnsCache;
}

async function filterColumnsForRelatorioInsert(columns = [], values = []) {
  const availableColumns = await getRelatorioTableColumns();
  const filteredColumns = [];
  const filteredValues = [];
  columns.forEach((column, index) => {
    if (availableColumns.has(column)) {
      filteredColumns.push(column);
      filteredValues.push(values[index]);
    }
  });
  return { columns: filteredColumns, values: filteredValues };
}

async function countRelatorioRowsInDatabase() {
  if (!(await ensureRelatorioTable())) return 0;
  try {
    const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(TABLE_NAME)}`);
    const total = Number(rows?.[0]?.total ?? rows?.[0]?.['COUNT(*)'] ?? 0);
    return Number.isFinite(total) ? total : 0;
  } catch (error) {
    disableRelatorioDb(error, 'countRelatorioRowsInDatabase');
    return 0;
  }
}

function buildImportKey(file = null) {
  if (!file) return null;
  return `${file.name}:${file.mtimeMs}:${file.size}`;
}

export async function syncLatestRelatorioFromFolder({ forceWhenDatabaseEmpty = true, source = 'sync', actor = null, ip = null } = {}) {
  for (const dir of importDirCandidates) ensureDir(dir);
  const latest = listSupportedImportFiles()[0] || null;
  const state = readState();

  let totalLinhasNoBanco = 0;
  try {
    totalLinhasNoBanco = await countRelatorioRowsInDatabase();
  } catch (error) {
    console.error('Falha ao contar linhas do relatório no banco:', error?.message || error);
  }

  if (!latest) {
    return {
      ok: true,
      imported: false,
      reason: 'no_file',
      totalLinhasNoBanco
    };
  }

  const currentKey = buildImportKey(latest);
  const sameFileAlreadyProcessed = state.lastProcessedKey === currentKey;
  const shouldForceBecauseDatabaseEmpty = !relatorioDbDisabled && forceWhenDatabaseEmpty && totalLinhasNoBanco === 0;
  const shouldImport = !sameFileAlreadyProcessed || shouldForceBecauseDatabaseEmpty;

  if (!shouldImport) {
    return {
      ok: true,
      imported: false,
      reason: 'up_to_date',
      fileName: latest.name,
      totalLinhasNoBanco,
      lastProcessedKey: state.lastProcessedKey || null
    };
  }

  const summary = await importRelatorioSpreadsheet({
    filePath: latest.filePath,
    originalName: latest.name,
    actor,
    source,
    ip
  });

  let totalDepois = totalLinhasNoBanco;
  try {
    totalDepois = await countRelatorioRowsInDatabase();
  } catch (error) {
    console.error('Falha ao contar linhas do relatório no banco após importação:', error?.message || error);
  }

  return {
    ...summary,
    imported: true,
    totalLinhasNoBanco: totalDepois
  };
}

export { countRelatorioRowsInDatabase };

async function replaceDatabaseSnapshot(rows = [], sourceFileName = '') {
  if (!(await ensureRelatorioTable())) {
    throw new Error(relatorioDbDisableReason || 'Banco do relatório terceirizado indisponível.');
  }

  let existingRows = [];
  try {
    existingRows = await prisma.$queryRawUnsafe(`SELECT rowHash, agendamentoId FROM ${quoteIdentifier(TABLE_NAME)} WHERE rowHash IS NOT NULL`);
  } catch (error) {
    disableRelatorioDb(error, 'replaceDatabaseSnapshot:readExistingRows');
    throw error;
  }
  const agendamentoMap = new Map((existingRows || []).map((row) => [String(row.rowHash || ''), row.agendamentoId == null ? null : Number(row.agendamentoId)]));

  await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(TABLE_NAME)}`);

  const deduplicatedRows = [];
  const seenRowHashes = new Set();

  for (const row of rows) {
    const normalizedRow = normalizeSpreadsheetRow(row);
    const rowHash = buildRowHash(normalizedRow);
    if (seenRowHashes.has(rowHash)) continue;
    seenRowHashes.add(rowHash);
    deduplicatedRows.push({ normalizedRow, rowHash });
  }

  const columns = ['rowHash', 'agendamentoId', ...SHEET_COLUMNS, 'origemArquivo', 'dadosOriginaisJson'];

  for (const row of deduplicatedRows) {
    const values = [
      row.rowHash,
      agendamentoMap.get(row.rowHash) ?? null,
      ...SHEET_COLUMNS.map((column) => row.normalizedRow[column]),
      sourceFileName || null,
      JSON.stringify(row.normalizedRow)
    ];
    const filtered = await filterColumnsForRelatorioInsert(columns, values);
    const columnSql = filtered.columns.map((column) => quoteIdentifier(column)).join(', ');
    const placeholders = filtered.columns.map(() => '?').join(', ');
    await prisma.$executeRawUnsafe(`INSERT IGNORE INTO ${quoteIdentifier(TABLE_NAME)} (${columnSql}) VALUES (${placeholders})`, ...filtered.values);
  }
}

function parseRowFromDatabase(row = {}) {
  const output = {
    rowHash: normalizeCellValue(row.rowHash ?? ''),
    agendamentoId: row.agendamentoId == null ? null : Number(row.agendamentoId)
  };
  for (const column of SHEET_COLUMNS) {
    output[column] = normalizeCellValue(row[column] ?? '');
  }
  return output;
}

export async function cleanupOrphanRelatorioAgendamentoLinks() {
  try {
    if (!(await ensureRelatorioTable())) return { cleaned: 0, source: 'disabled' };
    const cleaned = await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(TABLE_NAME)} rel
          LEFT JOIN ${quoteIdentifier('Agendamento')} ag
            ON ag.id = rel.agendamentoId
          SET rel.agendamentoId = NULL
        WHERE rel.agendamentoId IS NOT NULL
          AND ag.id IS NULL`
    );
    return { cleaned: Number(cleaned || 0), source: 'database' };
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao reconciliar vínculos órfãos do relatório:', error?.message || error);
    return { cleaned: 0, source: 'error', reason: error?.message || String(error || 'erro') };
  }
}

export async function listFornecedoresPendentesImportados() {
  try {
    if (await ensureRelatorioTable()) {
      await cleanupOrphanRelatorioAgendamentoLinks();
      const rows = await prisma.$queryRawUnsafe(
      `SELECT rowHash, agendamentoId, dadosOriginaisJson, importedAt, updatedAt
         FROM ${quoteIdentifier(TABLE_NAME)}
        WHERE agendamentoId IS NULL
        ORDER BY importedAt ASC, updatedAt ASC, rowHash ASC`
    );

      if (Array.isArray(rows) && rows.length) {
        const parsedRows = rows
        .map((row) => {
          try {
            const parsed = row?.dadosOriginaisJson ? JSON.parse(String(row.dadosOriginaisJson)) : {};
            return { ...normalizeSpreadsheetRow(parsed || {}), rowHash: normalizeCellValue(row?.rowHash || '') };
          } catch {
            return null;
          }
        })
        .filter((row) => row && row['Fornecedor'] && row['Nr. nota']);

        if (parsedRows.length) {
          return filterScheduledNotesFromGroups(normalizeImportedItems(parsedRows));
        }
      }
    }
  } catch (error) {
    disableRelatorioDb(error, 'listFornecedoresPendentesImportados');
    console.error('Falha ao listar pendências importadas no banco:', error?.message || error);
  }

  try {
    if (!fs.existsSync(fallbackFile)) return [];
    return filterScheduledNotesFromGroups(JSON.parse(fs.readFileSync(fallbackFile, 'utf8')) || []);
  } catch {
    return [];
  }
}


export async function removeNotasPendentesFromRelatorio({ fornecedor = '', notas = [] } = {}) {
  const normalizedSelection = Array.isArray(notas) ? notas.map(normalizeSelectedNota).filter((nota) => nota.rowHash || nota.numeroNf) : [];
  if (!normalizedSelection.length) return { removed: 0 };

  let removed = 0;
  try {
    if (await ensureRelatorioTable()) {
      for (const nota of normalizedSelection) {
        if (nota.rowHash) {
          removed += Number(await prisma.$executeRawUnsafe(
            `DELETE FROM ${quoteIdentifier(TABLE_NAME)} WHERE agendamentoId IS NULL AND rowHash = ?`,
            nota.rowHash
          ) || 0);
          continue;
        }

        removed += Number(await prisma.$executeRawUnsafe(
          `DELETE FROM ${quoteIdentifier(TABLE_NAME)}
            WHERE agendamentoId IS NULL
              AND LOWER(TRIM(${quoteIdentifier('Fornecedor')})) = LOWER(?)
              AND TRIM(${quoteIdentifier('Nr. nota')}) = ?
              AND COALESCE(TRIM(${quoteIdentifier('Série')}), '') = ?`,
          normalizeCellValue(fornecedor),
          nota.numeroNf,
          nota.serie
        ) || 0);
      }
    }
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao remover notas pendentes do banco:', error?.message || error);
  }

  try {
    const groups = readFallbackGroups();
    const blockedKeys = new Set(normalizedSelection.map((nota) => buildPendingNoteKey(nota)).filter(Boolean));
    const nextGroups = groups.map((group) => {
      const notasGrupo = Array.isArray(group?.notas) ? group.notas : Array.isArray(group?.notasFiscais) ? group.notasFiscais : [];
      const notasFiltradas = notasGrupo.filter((nota) => {
        const key = buildPendingNoteKey(nota);
        return !key || !blockedKeys.has(key);
      });
      return {
        ...group,
        notas: notasFiltradas,
        notasFiscais: notasFiltradas,
        quantidadeNotas: notasFiltradas.length,
        quantidadeVolumes: toFixedNumber(notasFiltradas.reduce((acc, item) => acc + Number(item?.volumes || 0), 0), 3),
        pesoTotalKg: toFixedNumber(notasFiltradas.reduce((acc, item) => acc + Number(item?.peso || 0), 0), 3),
        valorTotalNf: toFixedNumber(notasFiltradas.reduce((acc, item) => acc + Number(item?.valorNf || 0), 0), 2)
      };
    }).filter((group) => Array.isArray(group?.notas) && group.notas.length);
    writeFallback(nextGroups);
  } catch {}

  return { removed };
}

export async function linkRelatorioRowsToAgendamento(agendamentoId, fornecedor, notas = []) {
  if (!agendamentoId || !fornecedor || !Array.isArray(notas) || !notas.length) return;
  if (!(await ensureRelatorioTable())) return;

  for (const nota of notas) {
    const rowHash = normalizeCellValue(nota?.rowHash || '');
    const numeroNf = normalizeCellValue(nota?.numeroNf || nota?.numero_nf || '');
    const serie = normalizeCellValue(nota?.serie || '');
    if (rowHash) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${quoteIdentifier(TABLE_NAME)} SET agendamentoId = ? WHERE rowHash = ?`,
        Number(agendamentoId),
        rowHash
      );
      continue;
    }

    if (!numeroNf) continue;

    const conditions = [
      `LOWER(TRIM(${quoteIdentifier('Fornecedor')})) = LOWER(?)`,
      `TRIM(${quoteIdentifier('Nr. nota')}) = ?`
    ];
    const args = [Number(agendamentoId), fornecedor, numeroNf];

    if (serie) {
      conditions.push(`TRIM(${quoteIdentifier('Série')}) = ?`);
      args.push(serie);
    }

    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(TABLE_NAME)} SET agendamentoId = ? WHERE ${conditions.join(' AND ')}`,
      ...args
    );
  }
}

export async function unlinkRelatorioRowsFromAgendamento(agendamentoId) {
  if (!agendamentoId) return;
  try {
    if (!(await ensureRelatorioTable())) return;
    await prisma.$executeRawUnsafe(
      `UPDATE ${quoteIdentifier(TABLE_NAME)} SET agendamentoId = NULL WHERE agendamentoId = ?`,
      Number(agendamentoId)
    );
  } catch {}
}


function noteMatchesSelection(row = {}, fornecedor = '', nota = {}) {
  const fornecedorMatch = !fornecedor || normalizeCellValue(row['Fornecedor']).toLowerCase() === normalizeCellValue(fornecedor).toLowerCase();
  if (!fornecedorMatch) return false;
  const rowHash = normalizeCellValue(row.rowHash || buildRowHash(normalizeSpreadsheetRow(row)));
  const notaHash = normalizeCellValue(nota?.rowHash || '');
  if (notaHash && rowHash) return notaHash === rowHash;
  const numeroNf = normalizeCellValue(row['Nr. nota']);
  const serie = normalizeCellValue(row['Série']);
  return numeroNf === normalizeCellValue(nota?.numeroNf || '')
    && (!normalizeCellValue(nota?.serie || '') || serie === normalizeCellValue(nota?.serie || ''));
}

export async function removePendingNotasFromRelatorio({ fornecedor = '', notas = [] } = {}) {
  const selected = Array.isArray(notas) ? notas : [];
  if (!fornecedor || !selected.length) return { removed: 0, source: 'noop' };

  let removed = 0;
  try {
    if (await ensureRelatorioTable()) {
      for (const nota of selected) {
        const rowHash = normalizeCellValue(nota?.rowHash || '');
        if (rowHash) {
          removed += Number(await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(TABLE_NAME)} WHERE rowHash = ? AND agendamentoId IS NULL`, rowHash) || 0);
          continue;
        }
        const numeroNf = normalizeCellValue(nota?.numeroNf || '');
        const serie = normalizeCellValue(nota?.serie || '');
        if (!numeroNf) continue;
        const conditions = [`LOWER(TRIM(${quoteIdentifier('Fornecedor')})) = LOWER(?)`, `TRIM(${quoteIdentifier('Nr. nota')}) = ?`, `agendamentoId IS NULL`];
        const args = [fornecedor, numeroNf];
        if (serie) {
          conditions.push(`TRIM(${quoteIdentifier('Série')}) = ?`);
          args.push(serie);
        }
        removed += Number(await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(TABLE_NAME)} WHERE ${conditions.join(' AND ')}`, ...args) || 0);
      }
    }
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao remover notas pendentes do relatório no banco:', error?.message || error);
  }

  try {
    if (fs.existsSync(rawFallbackFile)) {
      const rows = JSON.parse(fs.readFileSync(rawFallbackFile, 'utf8')) || [];
      const filteredRows = rows.filter((row) => !selected.some((nota) => noteMatchesSelection({ ...row, rowHash: normalizeCellValue(row?.rowHash || '') }, fornecedor, nota)));
      removed = Math.max(removed, rows.length - filteredRows.length);
      writeRawFallback(filteredRows);
      writeFallback(normalizeImportedItems(filteredRows));
    }
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao remover notas pendentes do fallback em arquivo:', error?.message || error);
  }

  return { removed, source: removed > 0 ? 'mixed' : 'noop' };
}

export async function importRelatorioSpreadsheet({ filePath, originalName = '', actor = null, source = 'manual', ip = null } = {}) {
  return withRelatorioImportLock(async () => {
    const rows = parseSpreadsheetFile(filePath);
    if (!rows.length) throw new Error('Nenhuma linha válida foi encontrada na planilha.');

    const validRows = filterValidRows(rows);
    if (!validRows.length) throw new Error('Nenhum fornecedor com NF válida foi encontrado na planilha.');

    const groups = normalizeImportedItems(validRows);
    let persistedIn = 'arquivo';

    try {
      await replaceDatabaseSnapshot(validRows, originalName || path.basename(filePath));
      persistedIn = 'banco';
    } catch (error) {
      console.error('Falha ao persistir planilha no banco. Mantendo fallback em arquivo:', error?.message || error);
    }

    writeFallback(groups);
    writeRawFallback(validRows);

    const summary = {
      ok: true,
      totalLinhasLidas: rows.length,
      totalLinhasValidas: validRows.length,
      totalFornecedores: groups.length,
      totalNotas: groups.reduce((acc, item) => acc + Number(item.quantidadeNotas || 0), 0),
      totalPesoKg: toFixedNumber(groups.reduce((acc, item) => acc + Number(item.pesoTotalKg || 0), 0), 3),
      totalValorNf: toFixedNumber(groups.reduce((acc, item) => acc + Number(item.valorTotalNf || 0), 0), 2),
      persistedIn,
      source,
      fileName: originalName || path.basename(filePath),
      importedAt: new Date().toISOString()
    };

    const stats = fs.statSync(filePath);
    writeState({
      ...readState(),
      lastImport: summary,
      lastProcessedKey: buildFileKey(summary.fileName, stats)
    });

    if (actor?.sub || actor?.id) {
      await auditLog({
        usuarioId: actor.sub || actor.id,
        perfil: actor.perfil,
        acao: 'IMPORTAR_PLANILHA',
        entidade: 'RELATORIO_ENTRADAS',
        detalhes: summary,
        ip
      });
    }

    console.log(`[IMPORTACAO_RELATORIO] arquivo=${summary.fileName} validas=${summary.totalLinhasValidas} fornecedores=${summary.totalFornecedores} persistedIn=${summary.persistedIn}`);
    return summary;
  });
}

export function getRelatorioImportStatus() {
  return readState().lastImport || null;
}

export function getRelatorioImportStatusDetailed() {
  const state = readState();
  return {
    ultimoProcessamento: state.lastImport || null,
    lastProcessedKey: state.lastProcessedKey || null,
    pastasMonitoradas: [...importDirCandidates],
    bancoDesabilitado: relatorioDbDisabled,
    motivoBancoDesabilitado: relatorioDbDisableReason
  };
}


export async function getRelatorioRowsCount() {
  try {
    if (!(await ensureRelatorioTable())) return 0;
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(TABLE_NAME)}`);
    const total = Number(result?.[0]?.total || result?.[0]?.TOTAL || 0);
    return Number.isFinite(total) ? total : 0;
  } catch (error) {
    disableRelatorioDb(error, 'getRelatorioRowsCount');
    console.error('Falha ao contar linhas do relatório terceirizado:', error?.message || error);
    return 0;
  }
}

export async function ensureLatestRelatorioImport({ forceIfEmpty = true } = {}) {
  const latest = listSupportedImportFiles()[0];
  if (!latest) {
    console.log(`[RELATORIO_IMPORT] Nenhuma planilha encontrada nas pastas monitoradas: ${importDirCandidates.join(' | ')}`);
    return null;
  }

  const key = buildFileKey(latest.rawName || latest.name, latest);
  const state = readState();
  const totalLinhasNoBanco = await getRelatorioRowsCount();
  const shouldForceBecauseDatabaseEmpty = !relatorioDbDisabled && forceIfEmpty && totalLinhasNoBanco === 0;
  const shouldReimport = state.lastProcessedKey !== key || shouldForceBecauseDatabaseEmpty;

  if (!shouldReimport) {
    return {
      ok: true,
      skipped: true,
      motivo: 'arquivo_ja_processado',
      fileName: latest.name,
      totalLinhasNoBanco
    };
  }

  return importRelatorioSpreadsheet({
    filePath: latest.filePath,
    originalName: latest.name,
    source: forceIfEmpty && totalLinhasNoBanco === 0 ? 'auto-page-empty-db' : 'auto-page'
  });
}

export function listSupportedImportFiles() {
  const items = [];
  const seen = new Set();
  for (const dir of importDirCandidates) {
    try {
      ensureDir(dir);
      for (const nameBuffer of fs.readdirSync(dir, { encoding: 'buffer' })) {
        if (!SUPPORTED_EXTENSIONS.has(extnameSafe(nameBuffer).toLowerCase())) continue;
        const filePath = joinBufferPath(dir, nameBuffer);
        const stats = fs.statSync(filePath);
        const key = buildFileKey(nameBuffer, stats);
        if (seen.has(key) || !stats.isFile()) continue;
        seen.add(key);
        items.push({
          filePath,
          name: pathToDisplayName(nameBuffer),
          rawName: Buffer.from(nameBuffer),
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          sourceDir: dir
        });
      }
    } catch {}
  }
  return items.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function scanImportFolderAndProcess() {
  if (watcherBusy) return null;
  watcherBusy = true;
  try {
    return await syncLatestRelatorioFromFolder({
      forceWhenDatabaseEmpty: true,
      source: 'watcher'
    });
  } finally {
    watcherBusy = false;
  }
}

export function startRelatorioImportWatcher() {
  if (watcherHandle) return watcherHandle;
  for (const dir of importDirCandidates) ensureDir(dir);

  scanImportFolderAndProcess().catch((error) => {
    console.error('Falha na importação automática inicial da planilha:', error?.message || error);
  });

  watcherHandle = setInterval(() => {
    scanImportFolderAndProcess().catch((error) => {
      console.error('Falha na varredura automática da planilha:', error?.message || error);
    });
  }, WATCH_INTERVAL_MS);

  watcherHandle.unref?.();
  return watcherHandle;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    for (const dir of importDirCandidates) ensureDir(dir);
    cb(null, importDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `relatorio-${Date.now()}${ext}`);
  }
});

export const relatorioSpreadsheetUpload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      return cb(new Error('Formato inválido. Envie .ods, .xlsx, .csv ou .json.'));
    }
    cb(null, true);
  }
});

export function getImportDirectory() {
  for (const dir of importDirCandidates) ensureDir(dir);
  return importDir;
}
