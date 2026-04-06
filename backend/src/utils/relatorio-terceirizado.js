import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { getPrismaClient } from './prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const primaryUploadsDir = path.join(backendRoot, 'uploads', 'importacao-relatorio');
const legacyUploadsDir = path.join(backendRoot, 'backend', 'uploads', 'importacao-relatorio');
const candidateImportDirs = [primaryUploadsDir, legacyUploadsDir];
const statePath = path.join(backendRoot, 'data', 'importacao-relatorio-state.json');
const TABLE_NAME = 'RelatorioTerceirizado';
const LINK_TABLE_NAME = 'RelatorioTerceirizadoVinculo';
const WATCH_INTERVAL_MS = 60 * 1000;

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

const COLUMN_DEFS = {
  'Entrada': { type: 'VARCHAR(100)', kind: 'text' },
  'Fornecedor': { type: 'VARCHAR(255)', kind: 'text' },
  'Nr. nota': { type: 'VARCHAR(100)', kind: 'text' },
  'Série': { type: 'VARCHAR(50)', kind: 'text' },
  'Data emissão': { type: 'DATE', kind: 'date' },
  'Data de Entrada': { type: 'DATE', kind: 'date' },
  'Data 1º vencimento': { type: 'DATE', kind: 'date' },
  'Tipo custo entrada': { type: 'VARCHAR(120)', kind: 'text' },
  'Valor da nota': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor desconto': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Qtd. itens': { type: 'INT', kind: 'int' },
  'Valor produtos': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Total frete': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Volume total': { type: 'DECIMAL(15,3)', kind: 'decimal' },
  'Peso total': { type: 'DECIMAL(15,3)', kind: 'decimal' },
  'Outras desp.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Total entradas': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Status': { type: 'VARCHAR(100)', kind: 'text' },
  'Prazo médio': { type: 'DECIMAL(10,2)', kind: 'decimal' },
  'Empresa': { type: 'VARCHAR(100)', kind: 'text' },
  'Data do cadastro': { type: 'DATE', kind: 'date' },
  'Total de IPI': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Base de ICMS': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Total ICMS': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Desp. extras': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Desp. extr. mad.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Frete conhec.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Desp. financ.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Base de ST': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Total ST': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'DARE guia': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'DARE antecip.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'DARE 1566': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Serviços': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'ISSQN': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor apropriar': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor custo oper.': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'ISSQN retido': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor ICMS diferido': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Base FCP': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor FCP': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Base FCP ST': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor FCP ST': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'Valor FEEF - MT': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'ICMS desonerado': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'ICMS descontado PIS/COFINS': { type: 'DECIMAL(15,2)', kind: 'decimal' },
  'CFOP': { type: 'VARCHAR(20)', kind: 'text' }
};

let watcherHandle = null;
let watcherBusy = false;

function qid(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  const text = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''");
  return `'${text}'`;
}

function ensureImportDirs() {
  for (const dir of candidateImportDirs) fs.mkdirSync(dir, { recursive: true });
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

function normalizeMatchText(value = '') {
  return normalizeText(value).toLowerCase();
}

function parseNumberLike(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(/,/g, '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseIntegerLike(value) {
  const number = parseNumberLike(value);
  if (number == null) return null;
  return Math.trunc(number);
}

function parseDateLike(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = normalizeText(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

function convertValueForColumn(column, value) {
  const kind = COLUMN_DEFS[column]?.kind || 'text';
  if (kind === 'date') return parseDateLike(value);
  if (kind === 'decimal') return parseNumberLike(value);
  if (kind === 'int') return parseIntegerLike(value);
  const text = normalizeText(value);
  return text || null;
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

function desiredBaseColumns() {
  return PLANILHA_COLUMNS.map((column) => ({
    name: column,
    type: String(COLUMN_DEFS[column]?.type || 'TEXT').toLowerCase()
  }));
}

function normalizeMysqlType(type = '') {
  return String(type || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function tableExists(client, tableName) {
  const rows = await client.$queryRawUnsafe(`SHOW TABLES LIKE ${sqlLiteral(tableName)}`);
  return Array.isArray(rows) && rows.length > 0;
}

async function nextBackupTableName(client) {
  const base = `${TABLE_NAME}_backup_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}`;
  for (let i = 0; i < 1000; i += 1) {
    const candidate = i === 0 ? base : `${base}_${String(i).padStart(3, '0')}`;
    const exists = await tableExists(client, candidate);
    if (!exists) return candidate;
  }
  return `${base}_${Date.now()}`;
}

async function ensureRelatorioBaseTable(client) {
  const exists = await tableExists(client, TABLE_NAME);
  if (exists) {
    const currentColumns = await client.$queryRawUnsafe(`SHOW COLUMNS FROM ${qid(TABLE_NAME)}`);
    const current = (currentColumns || []).map((item) => ({
      name: String(item.Field || ''),
      type: normalizeMysqlType(item.Type || '')
    }));
    const expected = desiredBaseColumns();
    const sameShape = current.length === expected.length && current.every((item, index) => item.name === expected[index].name && item.type === expected[index].type);
    if (!sameShape) {
      const backupName = await nextBackupTableName(client);
      await client.$executeRawUnsafe(`RENAME TABLE ${qid(TABLE_NAME)} TO ${qid(backupName)}`);
    }
  }

  const baseColumnsSql = PLANILHA_COLUMNS
    .map((column) => `${qid(column)} ${COLUMN_DEFS[column].type} NULL`)
    .join(',\n      ');

  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${qid(TABLE_NAME)} (
      ${baseColumnsSql},
      INDEX ${qid('idx_relatorio_fornecedor')} (${qid('Fornecedor')}(191)),
      INDEX ${qid('idx_relatorio_nf')} (${qid('Nr. nota')}),
      INDEX ${qid('idx_relatorio_serie')} (${qid('Série')}),
      INDEX ${qid('idx_relatorio_status')} (${qid('Status')})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureRelatorioLinkTable(client) {
  await client.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${qid(LINK_TABLE_NAME)} (
      ${qid('id')} INT NOT NULL AUTO_INCREMENT,
      ${qid('fornecedor')} VARCHAR(191) NOT NULL,
      ${qid('nrNota')} VARCHAR(100) NOT NULL,
      ${qid('serie')} VARCHAR(50) NULL,
      ${qid('agendamentoId')} INT NOT NULL,
      ${qid('createdAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ${qid('updatedAt')} DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (${qid('id')}),
      UNIQUE KEY ${qid('uk_relatorio_vinculo')} (${qid('fornecedor')}, ${qid('nrNota')}, ${qid('serie')}),
      KEY ${qid('idx_relatorio_vinculo_agendamento')} (${qid('agendamentoId')})
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureSchema(client) {
  await ensureRelatorioBaseTable(client);
  await ensureRelatorioLinkTable(client);
}

export function getImportDirectory() {
  ensureImportDirs();
  return primaryUploadsDir;
}

export function listImportDirectories() {
  ensureImportDirs();
  return [...candidateImportDirs];
}

export function findLatestSpreadsheetFile() {
  ensureImportDirs();
  const files = [];
  for (const dir of candidateImportDirs) {
    for (const name of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, name);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
          files.push({ name, fullPath, stat, directory: dir });
        }
      } catch {
        // ignore unreadable file
      }
    }
  }
  files.sort((a, b) => (b.stat.mtimeMs - a.stat.mtimeMs) || a.name.localeCompare(b.name));
  return files[0] || null;
}

export async function countRelatorioRows() {
  try {
    const client = await getPrismaClient();
    await ensureSchema(client);
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
  await ensureSchema(client);
  await client.$executeRawUnsafe(`DELETE FROM ${qid(TABLE_NAME)}`);

  const columnsForInsert = [...PLANILHA_COLUMNS];
  const chunkSize = 100;

  for (let offset = 0; offset < parsedRows.length; offset += chunkSize) {
    const chunk = parsedRows.slice(offset, offset + chunkSize);
    const valuesSql = chunk.map((row) => `(${columnsForInsert
      .map((column) => sqlLiteral(convertValueForColumn(column, row[column])))
      .join(', ')})`).join(', ');
    const sql = `
      INSERT INTO ${qid(TABLE_NAME)} (${columnsForInsert.map(qid).join(', ')})
      VALUES ${valuesSql}
    `;
    await client.$executeRawUnsafe(sql);
  }

  const totalRows = await countRelatorioRows();
  writeState({
    fileName: latest.name,
    fileSize: latest.stat.size,
    fileMtimeMs: latest.stat.mtimeMs,
    directory: latest.directory,
    importedAt: new Date().toISOString(),
    totalRows
  });

  console.log(`[RELATORIO_IMPORT] arquivo=${latest.name} linhas=${parsedRows.length} totalBanco=${totalRows}`);
  return { ok: true, imported: true, totalRows, fileName: latest.name, filePath: latest.fullPath, validRows: parsedRows.length };
}

export async function fetchPendingFornecedoresFromDatabase() {
  const client = await getPrismaClient();
  await ensureSchema(client);
  const rows = await client.$queryRawUnsafe(`
    SELECT r.*
    FROM ${qid(TABLE_NAME)} r
    LEFT JOIN ${qid(LINK_TABLE_NAME)} l
      ON LOWER(TRIM(r.${qid('Fornecedor')})) = LOWER(TRIM(l.${qid('fornecedor')}))
      AND TRIM(r.${qid('Nr. nota')}) = TRIM(l.${qid('nrNota')})
      AND COALESCE(TRIM(r.${qid('Série')}), '') = COALESCE(TRIM(l.${qid('serie')}), '')
    WHERE l.${qid('id')} IS NULL
    ORDER BY r.${qid('Fornecedor')} ASC, r.${qid('Nr. nota')} ASC, r.${qid('Série')} ASC
  `);

  const grouped = new Map();
  for (const row of rows || []) {
    const fornecedor = normalizeText(row?.Fornecedor || row?.['Fornecedor']);
    if (!fornecedor) continue;
    const key = normalizeMatchText(fornecedor);
    const current = grouped.get(key) || {
      id: key,
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
      numeroNf: normalizeText(row['Nr. nota']),
      serie: normalizeText(row['Série']),
      chaveAcesso: '',
      volumes: Number(parseNumberLike(row['Volume total']) || 0),
      peso: Number(parseNumberLike(row['Peso total']) || 0),
      valorNf: Number(parseNumberLike(row['Valor da nota']) || 0),
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
  await ensureSchema(client);

  for (const nota of notas) {
    const numeroNf = normalizeText(nota?.numeroNf || nota?.numero_nf || '');
    if (!numeroNf) continue;
    const serie = normalizeText(nota?.serie || '');
    const sql = `
      INSERT INTO ${qid(LINK_TABLE_NAME)} (${qid('fornecedor')}, ${qid('nrNota')}, ${qid('serie')}, ${qid('agendamentoId')})
      VALUES (${sqlLiteral(fornecedor)}, ${sqlLiteral(numeroNf)}, ${sqlLiteral(serie || null)}, ${sqlLiteral(Number(agendamentoId))})
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
    importDirectory: primaryUploadsDir,
    importDirectories: listImportDirectories(),
    arquivoMaisRecente: latest ? latest.name : null,
    atualizadoEm: latest ? new Date(latest.stat.mtimeMs).toISOString() : null,
    totalLinhasNoBanco,
    state
  };
}

export async function scanImportFolderAndProcess() {
  if (watcherBusy) return null;
  watcherBusy = true;
  try {
    return await syncLatestRelatorioToDatabase();
  } finally {
    watcherBusy = false;
  }
}

export function startRelatorioImportWatcher() {
  if (watcherHandle) return watcherHandle;
  ensureImportDirs();
  scanImportFolderAndProcess().catch((error) => {
    console.error('[RELATORIO_IMPORT] Falha na importação automática inicial:', error?.message || error);
  });
  watcherHandle = setInterval(() => {
    scanImportFolderAndProcess().catch((error) => {
      console.error('[RELATORIO_IMPORT] Falha na varredura automática:', error?.message || error);
    });
  }, WATCH_INTERVAL_MS);
  watcherHandle.unref?.();
  return watcherHandle;
}
