import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPrismaClient } from './prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const primaryUploadsDir = path.join(backendRoot, 'uploads', 'importacao-relatorio');
const importDirCandidates = [...new Set([
  primaryUploadsDir,
  path.join(backendRoot, 'backend', 'uploads', 'importacao-relatorio'),
  path.resolve(process.cwd(), 'uploads', 'importacao-relatorio'),
  path.resolve(process.cwd(), 'backend', 'uploads', 'importacao-relatorio')
])];
const statePath = path.join(backendRoot, 'data', 'importacao-relatorio-state.json');
const TABLE_NAME = 'RelatorioTerceirizado';

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
  'CFOP'
];

const REQUIRED_HEADERS = ['Fornecedor', 'Nr. nota', 'Série'];
const SUPPORTED_EXTENSIONS = new Set(['.ods', '.csv']);
const COLUMN_DEFINITIONS = {
  'Entrada': 'VARCHAR(50)',
  'Fornecedor': 'VARCHAR(255)',
  'Nr. nota': 'VARCHAR(80)',
  'Série': 'VARCHAR(30)',
  'Data emissão': 'DATE',
  'Data de Entrada': 'DATE',
  'Data 1º vencimento': 'DATE',
  'Tipo custo entrada': 'VARCHAR(120)',
  'Valor da nota': 'DECIMAL(15,2)',
  'Valor desconto': 'DECIMAL(15,2)',
  'Qtd. itens': 'INT',
  'Valor produtos': 'DECIMAL(15,2)',
  'Total frete': 'DECIMAL(15,2)',
  'Volume total': 'DECIMAL(15,3)',
  'Peso total': 'DECIMAL(15,3)',
  'Outras desp.': 'DECIMAL(15,2)',
  'Total entradas': 'DECIMAL(15,2)',
  'Status': 'VARCHAR(80)',
  'Prazo médio': 'VARCHAR(40)',
  'Empresa': 'VARCHAR(120)',
  'Data do cadastro': 'DATETIME',
  'Total de IPI': 'DECIMAL(15,2)',
  'Base de ICMS': 'DECIMAL(15,2)',
  'Total ICMS': 'DECIMAL(15,2)',
  'Desp. extras': 'DECIMAL(15,2)',
  'Desp. extr. mad.': 'DECIMAL(15,2)',
  'Frete conhec.': 'DECIMAL(15,2)',
  'Desp. financ.': 'DECIMAL(15,2)',
  'Base de ST': 'DECIMAL(15,2)',
  'Total ST': 'DECIMAL(15,2)',
  'DARE guia': 'DECIMAL(15,2)',
  'DARE antecip.': 'DECIMAL(15,2)',
  'DARE 1566': 'DECIMAL(15,2)',
  'Serviços': 'DECIMAL(15,2)',
  'ISSQN': 'DECIMAL(15,2)',
  'Valor apropriar': 'DECIMAL(15,2)',
  'Valor custo oper.': 'DECIMAL(15,2)',
  'ISSQN retido': 'DECIMAL(15,2)',
  'Valor ICMS diferido': 'DECIMAL(15,2)',
  'Base FCP': 'DECIMAL(15,2)',
  'Valor FCP': 'DECIMAL(15,2)',
  'Base FCP ST': 'DECIMAL(15,2)',
  'Valor FCP ST': 'DECIMAL(15,2)',
  'Valor FEEF - MT': 'DECIMAL(15,2)',
  'ICMS desonerado': 'DECIMAL(15,2)',
  'ICMS descontado PIS/COFINS': 'DECIMAL(15,2)',
  'CFOP': 'VARCHAR(20)'
};

const DECIMAL_SCALE = {
  'Volume total': 3,
  'Peso total': 3
};

const TEXT_COLUMNS = new Set(Object.entries(COLUMN_DEFINITIONS).filter(([, sql]) => /^VARCHAR/i.test(sql)).map(([name]) => name));
const DATE_COLUMNS = new Set(Object.entries(COLUMN_DEFINITIONS).filter(([, sql]) => /^DATE$/i.test(sql)).map(([name]) => name));
const DATETIME_COLUMNS = new Set(Object.entries(COLUMN_DEFINITIONS).filter(([, sql]) => /^DATETIME$/i.test(sql)).map(([name]) => name));
const INT_COLUMNS = new Set(Object.entries(COLUMN_DEFINITIONS).filter(([, sql]) => /^INT$/i.test(sql)).map(([name]) => name));
const DECIMAL_COLUMNS = new Set(Object.entries(COLUMN_DEFINITIONS).filter(([, sql]) => /^DECIMAL/i.test(sql)).map(([name]) => name));

function qid(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function ensureImportDir() {
  fs.mkdirSync(primaryUploadsDir, { recursive: true });
}

function existingImportDirs() {
  return importDirCandidates.filter((dir) => {
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
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

function normalizeHeader(value = '') {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeText(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function parseDecimalForDb(value, scale = 2) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(scale));
  const raw = normalizeText(value);
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '').replace(/,/g, '.').replace(/[^\d.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? Number(number.toFixed(scale)) : null;
}

function parseIntegerForDb(value) {
  const number = parseDecimalForDb(value, 0);
  return Number.isFinite(number) ? Number(number) : null;
}

function parseDateForDb(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const dmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${month}-${day}`;
  }
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return raw;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 10);
  return null;
}

function parseDateTimeForDb(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const dateOnly = parseDateForDb(raw);
  if (dateOnly && !raw.includes(':')) return `${dateOnly} 00:00:00`;
  const dmyhm = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmyhm) {
    const day = dmyhm[1].padStart(2, '0');
    const month = dmyhm[2].padStart(2, '0');
    const hh = String(dmyhm[4] || '00').padStart(2, '0');
    const mm = String(dmyhm[5] || '00').padStart(2, '0');
    const ss = String(dmyhm[6] || '00').padStart(2, '0');
    return `${dmyhm[3]}-${month}-${day} ${hh}:${mm}:${ss}`;
  }
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso.toISOString().slice(0, 19).replace('T', ' ');
  return null;
}

function coerceColumnValue(column, value) {
  if (TEXT_COLUMNS.has(column)) {
    const text = normalizeText(value);
    return text || null;
  }
  if (DATE_COLUMNS.has(column)) return parseDateForDb(value);
  if (DATETIME_COLUMNS.has(column)) return parseDateTimeForDb(value);
  if (INT_COLUMNS.has(column)) return parseIntegerForDb(value);
  if (DECIMAL_COLUMNS.has(column)) return parseDecimalForDb(value, DECIMAL_SCALE[column] || 2);
  const text = normalizeText(value);
  return text || null;
}

function formatDateForApp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return normalizeText(value);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateTimeForApp(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return normalizeText(value);
  const day = String(date.getUTCDate()).padStart(2, '0');
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const year = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${day}/${month}/${year} ${hh}:${mm}:${ss}`;
}

function formatColumnValueForApp(column, value) {
  if (value == null) return '';
  if (DATE_COLUMNS.has(column)) return formatDateForApp(value);
  if (DATETIME_COLUMNS.has(column)) return formatDateTimeForApp(value);
  return normalizeText(value);
}

function parseNumberLike(value) {
  if (value == null) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(/,/g, '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
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

function parseCsvFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = csvSplitLine(lines[0], delimiter).map((item) => normalizeText(item));
  return lines.slice(1).map((line) => {
    const values = csvSplitLine(line, delimiter);
    return headers.reduce((acc, header, index) => {
      acc[header] = normalizeText(values[index] || '');
      return acc;
    }, {});
  });
}

function extractOdsContentXml(filePath) {
  try {
    return execFileSync('unzip', ['-p', filePath, 'content.xml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (unzipError) {
    const py = [
      'import sys, zipfile',
      'path = sys.argv[1]',
      'with zipfile.ZipFile(path) as zf:',
      '    data = zf.read("content.xml")',
      'sys.stdout.write(data.decode("utf-8"))'
    ].join('; ');
    return execFileSync('python3', ['-c', py, filePath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  }
}

function extractCellValuesFromOds(xml) {
  const tableMatch = xml.match(/<table:table\b[\s\S]*?>([\s\S]*?)<\/table:table>/i);
  if (!tableMatch) return [];
  const tableXml = tableMatch[1];
  const rowRegex = /<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gi;
  const rows = [];
  let rowMatch;

  while ((rowMatch = rowRegex.exec(tableXml))) {
    const rowAttrs = rowMatch[1] || '';
    const rowInner = rowMatch[2] || '';
    const rowRepeatMatch = rowAttrs.match(/table:number-rows-repeated="(\d+)"/i);
    const rowRepeat = Number(rowRepeatMatch?.[1] || 1) || 1;
    const cells = [];
    const cellRegex = /<table:(table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:\1>)/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowInner))) {
      const type = cellMatch[1];
      const attrs = cellMatch[2] || '';
      const inner = cellMatch[3] || '';
      const repeatMatch = attrs.match(/table:number-columns-repeated="(\d+)"/i);
      const repeat = Number(repeatMatch?.[1] || 1) || 1;
      let value = '';
      if (type !== 'covered-table-cell') {
        const paragraphs = [...inner.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/gi)];
        if (paragraphs.length) {
          value = paragraphs.map((entry) => normalizeWhitespace(entry[1] || '')).join(' ').trim();
        } else {
          const dateValue = attrs.match(/office:date-value="([^"]+)"/i)?.[1];
          const numericValue = attrs.match(/office:value="([^"]+)"/i)?.[1];
          value = normalizeText(dateValue || numericValue || normalizeWhitespace(inner));
        }
      }
      for (let index = 0; index < repeat; index += 1) cells.push(value);
    }

    for (let index = 0; index < rowRepeat; index += 1) rows.push([...cells]);
  }

  return rows;
}

function parseOdsFile(filePath) {
  const xml = extractOdsContentXml(filePath);
  const rows = extractCellValuesFromOds(xml);
  if (!rows.length) return [];

  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(cell));
    return normalized.includes('entrada') && normalized.includes('fornecedor') && normalized.includes('nr. nota');
  });
  if (headerIndex < 0) return [];

  const headerRow = rows[headerIndex];
  const positions = new Map();
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;
    const originalHeader = PLANILHA_COLUMNS.find((column) => normalizeHeader(column) === normalized);
    if (originalHeader && !positions.has(originalHeader)) positions.set(originalHeader, index);
  });

  const missing = REQUIRED_HEADERS.filter((header) => !positions.has(header));
  if (missing.length) throw new Error(`Cabeçalhos obrigatórios não encontrados: ${missing.join(', ')}`);

  return rows.slice(headerIndex + 1).map((row) => {
    const item = {};
    for (const column of PLANILHA_COLUMNS) {
      const pos = positions.get(column);
      item[column] = normalizeText(pos == null ? '' : row[pos] || '');
    }
    return item;
  });
}

function parseSpreadsheetFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') return parseCsvFile(filePath);
  if (extension === '.ods') return parseOdsFile(filePath);
  throw new Error(`Formato não suportado para importação automática: ${extension}`);
}

function sanitizeRows(rows = []) {
  return rows
    .map((row) => {
      const item = {};
      for (const column of PLANILHA_COLUMNS) item[column] = normalizeText(row?.[column] || '');
      return item;
    })
    .filter((row) => row['Fornecedor'] || row['Nr. nota'] || row['Entrada']);
}

function rowHash(row) {
  return crypto.createHash('sha256').update(JSON.stringify(PLANILHA_COLUMNS.map((column) => row?.[column] || ''))).digest('hex');
}

export function getImportDirectory() {
  ensureImportDir();
  return uploadsDir;
}

export function findLatestSpreadsheetFile() {
  ensureImportDir();
  const files = [];
  for (const dir of existingImportDirs()) {
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
        files.push({ name, fullPath, stat, directory: dir });
      } catch {}
    }
  }
  files.sort((a, b) => (b.stat.mtimeMs - a.stat.mtimeMs) || a.name.localeCompare(b.name));
  return files[0] || null;
}

async function ensureRelatorioTable(client) {
  const sql = `
    CREATE TABLE IF NOT EXISTS ${qid(TABLE_NAME)} (
      ${qid('id')} INT NOT NULL AUTO_INCREMENT,
      ${qid('rowHash')} VARCHAR(64) NOT NULL,
      ${qid('agendamentoId')} INT NULL,
      ${qid('origemArquivo')} VARCHAR(255) NULL,
      ${PLANILHA_COLUMNS.map((column) => `${qid(column)} ${COLUMN_DEFINITIONS[column] || 'TEXT'} NULL`).join(',\n      ')},
      ${qid('importedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ${qid('updatedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (${qid('id')}),
      UNIQUE KEY ${qid('uk_relatorio_rowhash')} (${qid('rowHash')}),
      KEY ${qid('idx_relatorio_agendamento')} (${qid('agendamentoId')}),
      KEY ${qid('idx_relatorio_fornecedor')} (${qid('Fornecedor')}),
      KEY ${qid('idx_relatorio_nota')} (${qid('Nr. nota')})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;
  await client.$executeRawUnsafe(sql);

  const existing = await client.$queryRawUnsafe(`SHOW COLUMNS FROM ${qid(TABLE_NAME)}`);
  const existingNames = new Set((existing || []).map((item) => String(item.Field || '')));

  for (const column of PLANILHA_COLUMNS) {
    const columnType = COLUMN_DEFINITIONS[column] || 'TEXT';
    if (!existingNames.has(column)) {
      await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid(column)} ${columnType} NULL`);
    } else {
      await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} MODIFY COLUMN ${qid(column)} ${columnType} NULL`);
    }
  }

  if (!existingNames.has('origemArquivo')) await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid('origemArquivo')} VARCHAR(255) NULL`);
  if (!existingNames.has('importedAt')) await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid('importedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  if (!existingNames.has('updatedAt')) await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid('updatedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
  if (!existingNames.has('rowHash')) await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid('rowHash')} VARCHAR(64) NOT NULL`);
  if (!existingNames.has('agendamentoId')) await client.$executeRawUnsafe(`ALTER TABLE ${qid(TABLE_NAME)} ADD COLUMN ${qid('agendamentoId')} INT NULL`);
}

export async function countRelatorioRows() {
  try {
    const client = await getPrismaClient();
    await ensureRelatorioTable(client);
    const rows = await client.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${qid(TABLE_NAME)}`);
    return Number(rows?.[0]?.total || rows?.[0]?.TOTAL || 0);
  } catch {
    return 0;
  }
}

export async function syncLatestRelatorioToDatabase({ force = false } = {}) {
  const latest = findLatestSpreadsheetFile();
  if (!latest) {
    return { ok: false, reason: 'Nenhuma planilha encontrada na pasta de importação.', totalRows: 0, imported: false };
  }

  const currentState = readState();
  const tableRowsBefore = await countRelatorioRows();
  const unchanged = currentState.fileName === latest.name
    && Number(currentState.fileSize || 0) === Number(latest.stat.size || 0)
    && Number(currentState.fileMtimeMs || 0) === Number(latest.stat.mtimeMs || 0);

  if (unchanged && tableRowsBefore > 0 && !force) {
    return {
      ok: true,
      imported: false,
      totalRows: tableRowsBefore,
      fileName: latest.name,
      filePath: latest.fullPath,
      reason: 'Arquivo já sincronizado e banco preenchido.'
    };
  }

  const parsedRows = sanitizeRows(parseSpreadsheetFile(latest.fullPath));
  if (!parsedRows.length) {
    return { ok: false, imported: false, totalRows: 0, fileName: latest.name, reason: 'A planilha foi lida, mas não contém linhas válidas.' };
  }

  const client = await getPrismaClient();
  await ensureRelatorioTable(client);
  await client.$executeRawUnsafe(`DELETE FROM ${qid(TABLE_NAME)} WHERE ${qid('agendamentoId')} IS NULL`);

  const columnsForInsert = ['rowHash', 'agendamentoId', 'origemArquivo', ...PLANILHA_COLUMNS];
  const updateAssignments = ['origemArquivo', ...PLANILHA_COLUMNS].map((column) => `${qid(column)} = VALUES(${qid(column)})`).join(', ');
  const chunkSize = 100;

  for (let offset = 0; offset < parsedRows.length; offset += chunkSize) {
    const chunk = parsedRows.slice(offset, offset + chunkSize);
    const placeholders = chunk.map(() => `(${columnsForInsert.map(() => '?').join(', ')})`).join(', ');
    const sql = `
      INSERT INTO ${qid(TABLE_NAME)} (${columnsForInsert.map(qid).join(', ')})
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE ${updateAssignments}, ${qid('updatedAt')} = CURRENT_TIMESTAMP
    `;
    const args = [];
    for (const row of chunk) {
      args.push(rowHash(row), null, latest.name, ...PLANILHA_COLUMNS.map((column) => coerceColumnValue(column, row[column])));
    }
    await client.$executeRawUnsafe(sql, ...args);
  }

  const totalRows = await countRelatorioRows();
  writeState({
    fileName: latest.name,
    fileSize: latest.stat.size,
    fileMtimeMs: latest.stat.mtimeMs,
    importedAt: new Date().toISOString(),
    totalRows
  });

  console.log(`[RELATORIO_IMPORT] arquivo=${latest.name} linhas=${parsedRows.length} totalBanco=${totalRows}`);
  return { ok: true, imported: true, totalRows, fileName: latest.name, filePath: latest.fullPath, validRows: parsedRows.length };
}

export async function fetchPendingFornecedoresFromDatabase() {
  const client = await getPrismaClient();
  await ensureRelatorioTable(client);
  const rows = await client.$queryRawUnsafe(`
    SELECT *
    FROM ${qid(TABLE_NAME)}
    WHERE ${qid('agendamentoId')} IS NULL
    ORDER BY ${qid('Fornecedor')} ASC, ${qid('Nr. nota')} ASC, ${qid('Série')} ASC
  `);

  const grouped = new Map();
  for (const row of rows || []) {
    const fornecedor = normalizeText(row?.Fornecedor || row?.['Fornecedor']);
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
      numeroNf: normalizeText(row['Nr. nota']),
      serie: normalizeText(row['Série']),
      chaveAcesso: '',
      volumes: parseNumberLike(row['Volume total']),
      peso: parseNumberLike(row['Peso total']),
      valorNf: parseNumberLike(row['Valor da nota']),
      observacao: normalizeText(row['Status']) ? `Status planilha: ${normalizeText(row['Status'])}` : ''
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
    quantidadeVolumes: Number(item.quantidadeVolumes.toFixed(3)),
    pesoTotalKg: Number(item.pesoTotalKg.toFixed(3)),
    valorTotalNf: Number(item.valorTotalNf.toFixed(2))
  }));
}

export async function linkRelatorioRowsToAgendamento(agendamentoId, fornecedor, notas = []) {
  if (!agendamentoId || !fornecedor || !Array.isArray(notas) || !notas.length) return;
  const client = await getPrismaClient();
  await ensureRelatorioTable(client);

  for (const nota of notas) {
    const numeroNf = normalizeText(nota?.numeroNf || nota?.numero_nf || '');
    if (!numeroNf) continue;
    const serie = normalizeText(nota?.serie || '');
    const conditions = [
      `${qid('agendamentoId')} IS NULL`,
      `LOWER(TRIM(${qid('Fornecedor')})) = LOWER(?)`,
      `TRIM(${qid('Nr. nota')}) = ?`
    ];
    const args = [Number(agendamentoId), fornecedor, numeroNf];
    if (serie) {
      conditions.push(`TRIM(${qid('Série')}) = ?`);
      args.push(serie);
    }
    const sql = `
      UPDATE ${qid(TABLE_NAME)}
      SET ${qid('agendamentoId')} = ?
      WHERE ${conditions.join(' AND ')}
    `;
    await client.$executeRawUnsafe(sql, ...args);
  }
}

export async function getRelatorioStatus() {
  const latest = findLatestSpreadsheetFile();
  const totalLinhasNoBanco = await countRelatorioRows();
  const state = readState();
  return {
    importDirectory: primaryUploadsDir,
    importDirectoriesScan: existingImportDirs(),
    arquivoMaisRecente: latest ? latest.name : null,
    atualizadoEm: latest ? new Date(latest.stat.mtimeMs).toISOString() : null,
    totalLinhasNoBanco,
    state
  };
}
