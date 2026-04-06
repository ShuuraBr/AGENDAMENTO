import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPrismaClient } from './prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(backendRoot, '..');
const cwd = process.cwd();
const statePath = path.join(backendRoot, 'data', 'importacao-relatorio-state.json');
const TABLE_NAME = 'RelatorioTerceirizado';
const LINK_TABLE = 'RelatorioTerceirizadoVinculo';
const SUPPORTED_EXTENSIONS = new Set(['.ods', '.csv']);
const WATCH_INTERVAL_MS = 60_000;
let watcherStarted = false;
let watcherTimer = null;

const PLANILHA_COLUMNS = [
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
  'Total entries',
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
  'CFOP'
];

const COLUMN_DEFS = {
  'Entrada': 'VARCHAR(50) NULL',
  'Fornecedor': 'VARCHAR(255) NULL',
  'Nr. nota': 'VARCHAR(80) NULL',
  'Série': 'VARCHAR(30) NULL',
  'Data emissão': 'DATE NULL',
  'Data de Entrada': 'DATE NULL',
  'Data 1º vencimento': 'DATE NULL',
  'Tipo custo entrada': 'VARCHAR(120) NULL',
  'Valor da nota': 'DECIMAL(15,2) NULL',
  'Valor desconto': 'DECIMAL(15,2) NULL',
  'Qtd. itens': 'INT(11) NULL',
  'Valor produtos': 'DECIMAL(15,2) NULL',
  'Total frete': 'DECIMAL(15,2) NULL',
  'Volume total': 'DECIMAL(15,3) NULL',
  'Peso total': 'DECIMAL(15,3) NULL',
  'Outras desp.': 'DECIMAL(15,2) NULL',
  'Total entries': 'DECIMAL(15,2) NULL',
  'Status': 'VARCHAR(80) NULL',
  'Prazo médio': 'VARCHAR(40) NULL',
  'Empresa': 'VARCHAR(120) NULL',
  'Data do cadastro': 'DATETIME NULL',
  'Total de IPI': 'DECIMAL(15,2) NULL',
  'Base de ICMS': 'DECIMAL(15,2) NULL',
  'Total ICMS': 'DECIMAL(15,2) NULL',
  'Desp. extras': 'DECIMAL(15,2) NULL',
  'Desp. extr. mad.': 'DECIMAL(15,2) NULL',
  'Frete conhec.': 'DECIMAL(15,2) NULL',
  'Desp. financ.': 'DECIMAL(15,2) NULL',
  'Base de ST': 'DECIMAL(15,2) NULL',
  'Total ST': 'DECIMAL(15,2) NULL',
  'DARE guia': 'DECIMAL(15,2) NULL',
  'DARE antecip.': 'DECIMAL(15,2) NULL',
  'DARE 1566': 'DECIMAL(15,2) NULL',
  'Serviços': 'DECIMAL(15,2) NULL',
  'ISSQN': 'DECIMAL(15,2) NULL',
  'Valor apropriar': 'DECIMAL(15,2) NULL',
  'Valor custo oper.': 'DECIMAL(15,2) NULL',
  'ISSQN retido': 'DECIMAL(15,2) NULL',
  'Valor ICMS diferido': 'DECIMAL(15,2) NULL',
  'Base FCP': 'DECIMAL(15,2) NULL',
  'Valor FCP': 'DECIMAL(15,2) NULL',
  'Base FCP ST': 'DECIMAL(15,2) NULL',
  'Valor FCP ST': 'DECIMAL(15,2) NULL',
  'Valor FEEF - MT': 'DECIMAL(15,2) NULL',
  'ICMS desonerado': 'DECIMAL(15,2) NULL',
  'ICMS descontado PIS/COFINS': 'DECIMAL(15,2) NULL',
  'CFOP': 'VARCHAR(30) NULL'
};

const HEADER_ALIASES = new Map([
  ['entrada', 'Entrada'],
  ['fornecedor', 'Fornecedor'],
  ['nr nota', 'Nr. nota'],
  ['nr. nota', 'Nr. nota'],
  ['numero nota', 'Nr. nota'],
  ['número nota', 'Nr. nota'],
  ['nota fiscal', 'Nr. nota'],
  ['serie', 'Série'],
  ['série', 'Série'],
  ['data emissao', 'Data emissão'],
  ['data emissão', 'Data emissão'],
  ['data de emissao', 'Data emissão'],
  ['data de emissão', 'Data emissão'],
  ['data entrada', 'Data de Entrada'],
  ['data de entrada', 'Data de Entrada'],
  ['data 1 vencimento', 'Data 1º vencimento'],
  ['data 1o vencimento', 'Data 1º vencimento'],
  ['data 1º vencimento', 'Data 1º vencimento'],
  ['tipo custo entrada', 'Tipo custo entrada'],
  ['valor da nota', 'Valor da nota'],
  ['valor nota', 'Valor da nota'],
  ['valor desconto', 'Valor desconto'],
  ['qtd itens', 'Qtd. itens'],
  ['qtd. itens', 'Qtd. itens'],
  ['quantidade itens', 'Qtd. itens'],
  ['valor produtos', 'Valor produtos'],
  ['total frete', 'Total frete'],
  ['volume total', 'Volume total'],
  ['peso total', 'Peso total'],
  ['outras desp', 'Outras desp.'],
  ['outras desp.', 'Outras desp.'],
  ['total entries', 'Total entries'],
  ['total entradas', 'Total entries'],
  ['status', 'Status'],
  ['prazo medio', 'Prazo médio'],
  ['prazo médio', 'Prazo médio'],
  ['empresa', 'Empresa'],
  ['data do cadastro', 'Data do cadastro'],
  ['total de ipi', 'Total de IPI'],
  ['base de icms', 'Base de ICMS'],
  ['total icms', 'Total ICMS'],
  ['desp extras', 'Desp. extras'],
  ['desp. extras', 'Desp. extras'],
  ['desp extr mad', 'Desp. extr. mad.'],
  ['desp. extr. mad.', 'Desp. extr. mad.'],
  ['frete conhec', 'Frete conhec.'],
  ['frete conhec.', 'Frete conhec.'],
  ['desp financ', 'Desp. financ.'],
  ['desp. financ.', 'Desp. financ.'],
  ['base de st', 'Base de ST'],
  ['total st', 'Total ST'],
  ['dare guia', 'DARE guia'],
  ['dare antecip', 'DARE antecip.'],
  ['dare antecip.', 'DARE antecip.'],
  ['dare 1566', 'DARE 1566'],
  ['servicos', 'Serviços'],
  ['serviços', 'Serviços'],
  ['issqn', 'ISSQN'],
  ['valor apropriar', 'Valor apropriar'],
  ['valor custo oper', 'Valor custo oper.'],
  ['valor custo oper.', 'Valor custo oper.'],
  ['issqn retido', 'ISSQN retido'],
  ['valor icms diferido', 'Valor ICMS diferido'],
  ['base fcp', 'Base FCP'],
  ['valor fcp', 'Valor FCP'],
  ['base fcp st', 'Base FCP ST'],
  ['valor fcp st', 'Valor FCP ST'],
  ['valor feef mt', 'Valor FEEF - MT'],
  ['valor feef - mt', 'Valor FEEF - MT'],
  ['icms desonerado', 'ICMS desonerado'],
  ['icms descontado pis/cofins', 'ICMS descontado PIS/COFINS'],
  ['cfop', 'CFOP']
]);

function qid(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function norm(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeHeader(value = '') {
  return norm(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[º°]/g, 'o')
    .replace(/[^a-zA-Z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function canonicalHeader(value = '') {
  const normalized = normalizeHeader(value);
  return HEADER_ALIASES.get(normalized) || PLANILHA_COLUMNS.find((col) => normalizeHeader(col) === normalized) || null;
}

function decodeXmlEntities(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function normalizeWhitespace(value = '') {
  return decodeXmlEntities(String(value).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function csvSplitLine(line, delimiter) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

function parseCsvToMatrix(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines.find((line) => line.includes(';')) ? ';' : ',';
  return lines.map((line) => csvSplitLine(line, delimiter).map((item) => norm(item)));
}

function extractOdsContentXml(filePath) {
  try {
    return execFileSync('unzip', ['-p', filePath, 'content.xml'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    const py = [
      'import sys, zipfile',
      'path = sys.argv[1]',
      'with zipfile.ZipFile(path) as zf:',
      '    data = zf.read("content.xml")',
      'sys.stdout.write(data.decode("utf-8"))'
    ].join('; ');
    return execFileSync('python3', ['-c', py, filePath], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }
}

function extractOdsTables(xml) {
  const tables = [];
  const tableRegex = /<table:table\b[^>]*>([\s\S]*?)<\/table:table>/gi;
  let tableMatch;
  while ((tableMatch = tableRegex.exec(xml))) {
    tables.push(tableMatch[1] || '');
  }
  return tables;
}

function extractRowsFromTableXml(tableXml) {
  const rowRegex = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gi;
  const rows = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableXml))) {
    const rowAttrs = rowMatch[1] || '';
    const rowInner = rowMatch[2] || '';
    const rowRepeat = Number(rowAttrs.match(/table:number-rows-repeated="(\d+)"/i)?.[1] || 1) || 1;
    const cells = [];
    const cellRegex = /<table:(table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:\1>)/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowInner))) {
      const type = cellMatch[1];
      const attrs = cellMatch[2] || '';
      const inner = cellMatch[3] || '';
      const repeat = Number(attrs.match(/table:number-columns-repeated="(\d+)"/i)?.[1] || 1) || 1;
      let value = '';
      if (type !== 'covered-table-cell') {
        const paragraphs = [...inner.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi)];
        if (paragraphs.length) {
          value = paragraphs.map((entry) => normalizeWhitespace(entry[1] || '')).join(' ').trim();
        } else {
          value = norm(
            attrs.match(/office:date-value="([^"]+)"/i)?.[1]
            || attrs.match(/office:value="([^"]+)"/i)?.[1]
            || normalizeWhitespace(inner)
          );
        }
      }
      for (let i = 0; i < repeat; i += 1) cells.push(value);
    }
    for (let i = 0; i < rowRepeat; i += 1) rows.push([...cells]);
  }
  return rows;
}

function parseOdsToMatrix(filePath) {
  const xml = extractOdsContentXml(filePath);
  const tables = extractOdsTables(xml);
  const out = [];
  for (const tableXml of tables) {
    out.push(...extractRowsFromTableXml(tableXml));
  }
  return out;
}

function findHeaderRow(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const canonical = row.map((cell) => canonicalHeader(cell));
    const hitSet = new Set(canonical.filter(Boolean));
    if (hitSet.has('Fornecedor') && hitSet.has('Nr. nota') && (hitSet.has('Entrada') || hitSet.has('Série') || hitSet.has('Data emissão'))) {
      const positions = new Map();
      canonical.forEach((header, idx) => {
        if (header && !positions.has(header)) positions.set(header, idx);
      });
      return { index: i, positions };
    }
  }
  return null;
}

function matrixToRows(matrix) {
  if (!matrix.length) return [];
  const headerInfo = findHeaderRow(matrix);
  if (!headerInfo) return [];
  const { index: headerIndex, positions } = headerInfo;
  const rows = [];
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i] || [];
    const item = {};
    let hasValue = false;
    for (const column of PLANILHA_COLUMNS) {
      const pos = positions.get(column);
      const value = norm(pos == null ? '' : row[pos] || '');
      item[column] = value;
      if (value) hasValue = true;
    }
    const fornecedor = item['Fornecedor'];
    const nota = item['Nr. nota'];
    if (!hasValue) continue;
    if (!fornecedor && !nota) continue;
    rows.push(item);
  }
  return rows;
}

function parseSpreadsheetFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const matrix = extension === '.csv' ? parseCsvToMatrix(filePath)
    : extension === '.ods' ? parseOdsToMatrix(filePath)
    : [];
  if (!matrix.length) return [];
  return matrixToRows(matrix);
}

function getCandidateImportDirectories() {
  const dirs = [
    path.join(backendRoot, 'uploads', 'importacao-relatorio'),
    path.join(repoRoot, 'backend', 'uploads', 'importacao-relatorio'),
    path.join(repoRoot, 'uploads', 'importacao-relatorio'),
    path.join(cwd, 'backend', 'uploads', 'importacao-relatorio'),
    path.join(cwd, 'uploads', 'importacao-relatorio')
  ];
  return [...new Set(dirs.map((dir) => path.resolve(dir)))];
}

function ensureImportDirs() {
  for (const dir of getCandidateImportDirectories()) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
}

function scoreFile(item) {
  const lower = item.name.toLowerCase();
  let score = 0;
  if (lower.includes('relat')) score += 5;
  if (lower.includes('entrada')) score += 5;
  if (lower.includes('sint')) score += 5;
  if (lower.includes('sintet')) score += 5;
  return score;
}

export function getImportDirectory() {
  ensureImportDirs();
  return getCandidateImportDirectories()[0];
}

export function findLatestSpreadsheetFile() {
  ensureImportDirs();
  const candidates = [];
  for (const dir of getCandidateImportDirectories()) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { names = []; }
    for (const name of names) {
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        const ext = path.extname(name).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
        candidates.push({ dir, name, fullPath, stat, priority: scoreFile({ name }) });
      } catch {}
    }
  }
  candidates.sort((a, b) => (b.priority - a.priority) || (b.stat.mtimeMs - a.stat.mtimeMs) || a.name.localeCompare(b.name));
  const latest = candidates[0] || null;
  if (latest) {
    console.log(`[RELATORIO_IMPORT] candidato=${latest.fullPath}`);
  } else {
    console.log('[RELATORIO_IMPORT] Nenhuma planilha encontrada nas pastas monitoradas.');
  }
  return latest;
}

function readState() {
  try {
    if (!fs.existsSync(statePath)) return {};
    return JSON.parse(fs.readFileSync(statePath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeState(payload) {
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao gravar estado:', error?.message || error);
  }
}

function normalizeFornecedor(value = '') {
  return norm(value).toLowerCase();
}

function parseDecimal(value) {
  const raw = norm(value);
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '').replace(/,/g, '.').replace(/[^0-9.-]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseInteger(value) {
  const dec = parseDecimal(value);
  return dec == null ? null : Math.round(dec);
}

function parseDateOnly(value) {
  const raw = norm(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, d, m, y] = br;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  return null;
}

function parseDateTime(value) {
  const raw = norm(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(raw)) {
    return raw.length === 10 ? `${raw} 00:00:00` : raw.length === 16 ? `${raw}:00` : raw;
  }
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const [, d, m, y, hh = '00', mm = '00', ss = '00'] = br;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${hh.padStart(2, '0')}:${mm}:${ss}`;
  }
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  return null;
}

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function convertColumnValue(column, value) {
  switch (column) {
    case 'Data emissão':
    case 'Data de Entrada':
    case 'Data 1º vencimento':
      return parseDateOnly(value);
    case 'Data do cadastro':
      return parseDateTime(value);
    case 'Qtd. itens':
      return parseInteger(value);
    case 'Valor da nota':
    case 'Valor desconto':
    case 'Valor produtos':
    case 'Total frete':
    case 'Volume total':
    case 'Peso total':
    case 'Outras desp.':
    case 'Total entries':
    case 'Total de IPI':
    case 'Base de ICMS':
    case 'Total ICMS':
    case 'Desp. extras':
    case 'Desp. extr. mad.':
    case 'Frete conhec.':
    case 'Desp. financ.':
    case 'Base de ST':
    case 'Total ST':
    case 'DARE guia':
    case 'DARE antecip.':
    case 'DARE 1566':
    case 'Serviços':
    case 'ISSQN':
    case 'Valor apropriar':
    case 'Valor custo oper.':
    case 'ISSQN retido':
    case 'Valor ICMS diferido':
    case 'Base FCP':
    case 'Valor FCP':
    case 'Base FCP ST':
    case 'Valor FCP ST':
    case 'Valor FEEF - MT':
    case 'ICMS desonerado':
    case 'ICMS descontado PIS/COFINS':
      return parseDecimal(value);
    default:
      return norm(value) || null;
  }
}

async function ensureTables(client) {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${qid(TABLE_NAME)} (
      ${qid('id')} INT(11) NOT NULL AUTO_INCREMENT,
      ${PLANILHA_COLUMNS.map((column) => `${qid(column)} ${COLUMN_DEFS[column]}`).join(',\n      ')},
      PRIMARY KEY (${qid('id')}),
      KEY ${qid('idx_relatorio_fornecedor')} (${qid('Fornecedor')}),
      KEY ${qid('idx_relatorio_nota')} (${qid('Nr. nota')}),
      KEY ${qid('idx_relatorio_serie')} (${qid('Série')})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${qid(LINK_TABLE)} (
      ${qid('id')} INT(11) NOT NULL AUTO_INCREMENT,
      ${qid('fornecedorNorm')} VARCHAR(255) NOT NULL,
      ${qid('numeroNf')} VARCHAR(80) NOT NULL,
      ${qid('serie')} VARCHAR(30) NOT NULL DEFAULT '',
      ${qid('agendamentoId')} INT(11) NOT NULL,
      ${qid('createdAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ${qid('updatedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (${qid('id')}),
      UNIQUE KEY ${qid('uk_relatorio_vinculo_nf')} (${qid('fornecedorNorm')}, ${qid('numeroNf')}, ${qid('serie')}),
      KEY ${qid('idx_relatorio_vinculo_agendamento')} (${qid('agendamentoId')})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

export async function countRelatorioRows() {
  try {
    const client = await getPrismaClient();
    await ensureTables(client);
    const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${qid(TABLE_NAME)}`);
    return Number(rows?.[0]?.total || 0);
  } catch (error) {
    console.error('[RELATORIO_IMPORT] Falha ao contar linhas:', error?.message || error);
    return 0;
  }
}

function sanitizeRows(rows = []) {
  return rows
    .map((row) => {
      const out = {};
      for (const column of PLANILHA_COLUMNS) out[column] = norm(row?.[column] || '');
      return out;
    })
    .filter((row) => row['Fornecedor'] || row['Nr. nota'] || row['Entrada']);
}

export async function syncLatestRelatorioToDatabase({ force = false } = {}) {
  const latest = findLatestSpreadsheetFile();
  if (!latest) {
    writeState({ importedAt: new Date().toISOString(), reason: 'Nenhuma planilha encontrada.' });
    return { ok: false, imported: false, totalRows: 0, reason: 'Nenhuma planilha encontrada na pasta de importação.' };
  }

  const state = readState();
  const currentCount = await countRelatorioRows();
  const unchanged = state.fileName === latest.name
    && Number(state.fileSize || 0) === Number(latest.stat.size || 0)
    && Number(state.fileMtimeMs || 0) === Number(latest.stat.mtimeMs || 0);

  if (unchanged && currentCount > 0 && !force) {
    return { ok: true, imported: false, totalRows: currentCount, fileName: latest.name, reason: 'Arquivo já sincronizado.' };
  }

  const parsedRows = sanitizeRows(parseSpreadsheetFile(latest.fullPath));
  if (!parsedRows.length) {
    console.error(`[RELATORIO_IMPORT] arquivo=${latest.fullPath} sem linhas válidas após leitura.`);
    writeState({
      fileName: latest.name,
      fileSize: latest.stat.size,
      fileMtimeMs: latest.stat.mtimeMs,
      importedAt: new Date().toISOString(),
      totalRows: 0,
      reason: 'Planilha lida sem linhas válidas.'
    });
    return { ok: false, imported: false, totalRows: 0, fileName: latest.name, reason: 'A planilha foi lida, mas não contém linhas válidas.' };
  }

  const client = await getPrismaClient();
  await ensureTables(client);
  await client.$executeRawUnsafe(`DELETE FROM ${qid(TABLE_NAME)}`);

  const chunkSize = 200;
  const insertColumns = PLANILHA_COLUMNS.map(qid).join(', ');
  for (let offset = 0; offset < parsedRows.length; offset += chunkSize) {
    const chunk = parsedRows.slice(offset, offset + chunkSize);
    const valuesSql = chunk.map((row) => {
      const values = PLANILHA_COLUMNS.map((column) => sqlLiteral(convertColumnValue(column, row[column]))).join(', ');
      return `(${values})`;
    }).join(',\n');
    const sql = `INSERT INTO ${qid(TABLE_NAME)} (${insertColumns}) VALUES\n${valuesSql}`;
    await client.$executeRawUnsafe(sql);
  }

  const totalRows = await countRelatorioRows();
  writeState({
    fileName: latest.name,
    filePath: latest.fullPath,
    fileSize: latest.stat.size,
    fileMtimeMs: latest.stat.mtimeMs,
    importedAt: new Date().toISOString(),
    totalRows,
    reason: totalRows ? 'Importação concluída.' : 'Tabela sem linhas após importação.'
  });

  console.log(`[RELATORIO_IMPORT] arquivo=${latest.fullPath} linhas=${parsedRows.length} totalBanco=${totalRows}`);
  return { ok: true, imported: true, totalRows, fileName: latest.name, filePath: latest.fullPath, validRows: parsedRows.length };
}

function toFixedNumber(value, digits) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Number(num.toFixed(digits)) : 0;
}

export async function fetchPendingFornecedoresFromDatabase() {
  const client = await getPrismaClient();
  await ensureTables(client);
  const rows = await client.$queryRawUnsafe(`
    SELECT r.*
    FROM ${qid(TABLE_NAME)} r
    LEFT JOIN ${qid(LINK_TABLE)} v
      ON LOWER(TRIM(r.${qid('Fornecedor')})) = v.${qid('fornecedorNorm')}
     AND TRIM(r.${qid('Nr. nota')}) = v.${qid('numeroNf')}
     AND TRIM(COALESCE(r.${qid('Série')}, '')) = v.${qid('serie')}
    WHERE v.${qid('id')} IS NULL
    ORDER BY r.${qid('Fornecedor')} ASC, r.${qid('Nr. nota')} ASC, r.${qid('Série')} ASC
  `);

  const grouped = new Map();
  for (const row of rows || []) {
    const fornecedor = norm(row?.Fornecedor);
    if (!fornecedor) continue;
    const key = fornecedor.toLowerCase();
    const current = grouped.get(key) || {
      id: row.id,
      fornecedor,
      transportadora: '',
      motorista: '',
      cpfMotorista: '',
      placa: '',
      quantidadeNotas: 0,
      quantidadeVolumes: 0,
      pesoTotalKg: 0,
      valorTotalNf: 0,
      notas: []
    };
    const nota = {
      relatorioId: row.id,
      numeroNf: norm(row['Nr. nota']),
      serie: norm(row['Série']),
      chaveAcesso: '',
      volumes: Number(row['Volume total'] || 0),
      peso: Number(row['Peso total'] || 0),
      valorNf: Number(row['Valor da nota'] || 0),
      observacao: norm(row['Status']) ? `Status planilha: ${norm(row['Status'])}` : ''
    };
    current.notas.push(nota);
    current.quantidadeNotas += 1;
    current.quantidadeVolumes += Number(nota.volumes || 0);
    current.pesoTotalKg += Number(nota.peso || 0);
    current.valorTotalNf += Number(nota.valorNf || 0);
    grouped.set(key, current);
  }

  return [...grouped.values()].map((item) => ({
    ...item,
    quantidadeVolumes: toFixedNumber(item.quantidadeVolumes, 3),
    pesoTotalKg: toFixedNumber(item.pesoTotalKg, 3),
    valorTotalNf: toFixedNumber(item.valorTotalNf, 2)
  }));
}

export async function linkRelatorioRowsToAgendamento(agendamentoId, fornecedor, notas = []) {
  if (!agendamentoId || !fornecedor || !Array.isArray(notas) || !notas.length) return;
  const client = await getPrismaClient();
  await ensureTables(client);
  const fornecedorNorm = normalizeFornecedor(fornecedor);
  for (const nota of notas) {
    const numeroNf = norm(nota?.numeroNf || nota?.numero_nf || '');
    if (!numeroNf) continue;
    const serie = norm(nota?.serie || '');
    const sql = `
      INSERT INTO ${qid(LINK_TABLE)} (${qid('fornecedorNorm')}, ${qid('numeroNf')}, ${qid('serie')}, ${qid('agendamentoId')})
      VALUES (${sqlLiteral(fornecedorNorm)}, ${sqlLiteral(numeroNf)}, ${sqlLiteral(serie)}, ${sqlLiteral(Number(agendamentoId))})
      ON DUPLICATE KEY UPDATE ${qid('agendamentoId')} = VALUES(${qid('agendamentoId')}), ${qid('updatedAt')} = CURRENT_TIMESTAMP
    `;
    await client.$executeRawUnsafe(sql);
  }
}

export async function getRelatorioStatus() {
  const latest = findLatestSpreadsheetFile();
  const totalLinhasNoBanco = await countRelatorioRows();
  const state = readState();
  return {
    importDirectory: getImportDirectory(),
    candidateDirectories: getCandidateImportDirectories(),
    arquivoMaisRecente: latest ? latest.name : null,
    arquivoMaisRecentePath: latest ? latest.fullPath : null,
    atualizadoEm: latest ? new Date(latest.stat.mtimeMs).toISOString() : null,
    totalLinhasNoBanco,
    state
  };
}

export function startRelatorioTerceirizadoWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;
  const run = async () => {
    try {
      await syncLatestRelatorioToDatabase();
    } catch (error) {
      console.error('[RELATORIO_IMPORT] Falha no monitor automático:', error?.message || error);
    }
  };
  void run();
  watcherTimer = setInterval(run, WATCH_INTERVAL_MS);
  if (typeof watcherTimer?.unref === 'function') watcherTimer.unref();
}
