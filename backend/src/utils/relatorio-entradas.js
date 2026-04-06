import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { auditLog } from './audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const dataDir = path.resolve(backendRoot, 'data');
const uploadsDir = path.resolve(backendRoot, 'uploads');
const importDir = path.join(uploadsDir, 'importacao-relatorio');
const fallbackFile = path.join(dataDir, 'fornecedores-pendentes.json');
const rawFallbackFile = path.join(dataDir, 'relatorio-terceirizado-raw.json');
const stateFile = path.join(dataDir, 'importacao-relatorio-state.json');

const SUPPORTED_EXTENSIONS = new Set(['.ods', '.csv', '.json']);
const TABLE_NAME = 'RelatorioTerceirizado';
const WATCH_INTERVAL_MS = 60 * 1000;

const SHEET_COLUMNS = [
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

let watcherHandle = null;
let watcherBusy = false;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function quoteIdentifier(value = '') {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function xmlUnescape(value = '') {
  return String(value || '')
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

function buildNoteObservation(row = {}) {
  const parts = [];
  if (row['Entrada']) parts.push(`Entrada ${row['Entrada']}`);
  if (row['Data emissão']) parts.push(`Emissão ${row['Data emissão']}`);
  if (row['Data de Entrada']) parts.push(`Entrada ${row['Data de Entrada']}`);
  if (row['Status']) parts.push(`Status ${row['Status']}`);
  return parts.join(' | ');
}

function normalizeSpreadsheetRow(row = {}) {
  const normalized = {};
  for (const column of SHEET_COLUMNS) {
    normalized[column] = normalizeCellValue(row[column] ?? '');
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
    const fornecedor = normalizeCellValue(row['Fornecedor']);
    const numeroNf = normalizeCellValue(row['Nr. nota']);
    if (!fornecedor || !numeroNf) continue;

    if (!groups.has(fornecedor)) {
      groups.set(fornecedor, {
        id: groups.size + 1,
        fornecedor,
        transportadora: null,
        notas: [],
        notasFiscais: [],
        quantidadeNotas: 0,
        quantidadeVolumes: 0,
        pesoTotalKg: 0,
        valorTotalNf: 0,
        status: 'AGUARDANDO_CHEGADA',
        statusRelatorio: 'Aguardando Chegada'
      });
    }

    const current = groups.get(fornecedor);
    const note = {
      numeroNf,
      serie: normalizeCellValue(row['Série']),
      volumes: toFixedNumber(parseNumber(row['Volume total']), 3),
      peso: toFixedNumber(parseNumber(row['Peso total']), 3),
      valorNf: toFixedNumber(parseNumber(row['Valor da nota']), 2),
      observacao: buildNoteObservation(row)
    };

    current.notas.push(note);
    current.notasFiscais = current.notas;
    current.quantidadeNotas += 1;
    current.quantidadeVolumes = toFixedNumber(current.quantidadeVolumes + Number(note.volumes || 0), 3);
    current.pesoTotalKg = toFixedNumber(current.pesoTotalKg + Number(note.peso || 0), 3);
    current.valorTotalNf = toFixedNumber(current.valorTotalNf + Number(note.valorNf || 0), 2);
  }

  return [...groups.values()].sort((a, b) => String(a.fornecedor || '').localeCompare(String(b.fornecedor || ''), 'pt-BR'));
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
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeCellValue);

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

  const headers = rows[headerIndex].map(normalizeCellValue);
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

function parseSpreadsheetFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error('Formato de planilha não suportado. Use .ods, .csv ou .json.');
  }

  if (ext === '.csv') return parseCsv(fs.readFileSync(filePath, 'utf8'));
  if (ext === '.json') return parseJsonFile(fs.readFileSync(filePath, 'utf8'));
  if (ext === '.ods') {
    const xml = readZipEntry(filePath, 'content.xml').toString('utf8');
    return parseOdsContentXml(xml);
  }

  return [];
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

async function ensureRelatorioTable() {
  const businessColumnsSql = SHEET_COLUMNS
    .map((column) => `${quoteIdentifier(column)} TEXT NULL`)
    .join(',\n      ');

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${quoteIdentifier(TABLE_NAME)} (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ${businessColumnsSql},
      origemArquivo VARCHAR(255) NULL,
      importedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      dadosOriginaisJson LONGTEXT NULL,
      INDEX idx_relatorio_fornecedor (${quoteIdentifier('Fornecedor')}(191)),
      INDEX idx_relatorio_nf (${quoteIdentifier('Nr. nota')}(191)),
      INDEX idx_relatorio_status (${quoteIdentifier('Status')}(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const existingColumns = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
  const existingNames = new Set((existingColumns || []).map((item) => String(item.Field || '')));

  for (const column of SHEET_COLUMNS) {
    if (!existingNames.has(column)) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN ${quoteIdentifier(column)} TEXT NULL`);
    }
  }

  if (!existingNames.has('origemArquivo')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN origemArquivo VARCHAR(255) NULL`);
  }
  if (!existingNames.has('importedAt')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN importedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`);
  }
  if (!existingNames.has('updatedAt')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
  }
  if (!existingNames.has('dadosOriginaisJson')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN dadosOriginaisJson LONGTEXT NULL`);
  }
}


async function getImportedRowCount() {
  try {
    await ensureRelatorioTable();
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(TABLE_NAME)}`);
    return Number(result?.[0]?.total || result?.[0]?.['COUNT(*)'] || 0);
  } catch {
    return 0;
  }
}

async function replaceDatabaseSnapshot(rows = [], sourceFileName = '') {
  await ensureRelatorioTable();
  await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(TABLE_NAME)}`);

  const columns = [...SHEET_COLUMNS, 'origemArquivo', 'dadosOriginaisJson'];
  const placeholders = columns.map(() => '?').join(', ');
  const columnSql = columns.map((column) => quoteIdentifier(column)).join(', ');

  for (const row of rows) {
    const values = SHEET_COLUMNS.map((column) => normalizeCellValue(row[column] ?? ''));
    values.push(sourceFileName || null);
    values.push(JSON.stringify(row));
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${quoteIdentifier(TABLE_NAME)} (${columnSql}) VALUES (${placeholders})`,
      ...values
    );
  }
}

function parseRowFromDatabase(row = {}) {
  const output = {};
  for (const column of SHEET_COLUMNS) {
    output[column] = normalizeCellValue(row[column] ?? '');
  }
  return output;
}

export async function listFornecedoresPendentesImportados() {
  try {
    await ensureRelatorioTable();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM ${quoteIdentifier(TABLE_NAME)} ORDER BY ${quoteIdentifier('Fornecedor')} ASC, id ASC`
    );

    if (Array.isArray(rows) && rows.length) {
      return normalizeImportedItems(rows.map(parseRowFromDatabase));
    }
  } catch (error) {
    console.error('Falha ao listar pendências importadas no banco:', error?.message || error);
  }

  try {
    if (!fs.existsSync(fallbackFile)) return [];
    return JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
  } catch {
    return [];
  }
}

export async function importRelatorioSpreadsheet({ filePath, originalName = '', actor = null, source = 'manual', ip = null } = {}) {
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
    lastProcessedKey: `${summary.fileName}:${stats.mtimeMs}:${stats.size}`
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

  return summary;
}

export function getRelatorioImportStatus() {
  return readState().lastImport || null;
}

export function listSupportedImportFiles() {
  ensureDir(importDir);
  return fs.readdirSync(importDir)
    .map((name) => path.join(importDir, name))
    .filter((filePath) => SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase()))
    .map((filePath) => {
      const stats = fs.statSync(filePath);
      return { filePath, name: path.basename(filePath), mtimeMs: stats.mtimeMs, size: stats.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export async function scanImportFolderAndProcess() {
  if (watcherBusy) return null;
  watcherBusy = true;
  try {
    const latest = listSupportedImportFiles()[0];
    if (!latest) return null;

    const key = `${latest.name}:${latest.mtimeMs}:${latest.size}`;
    const state = readState();
    const rowCount = await getImportedRowCount();
    const sameFileAlreadyProcessed = state.lastProcessedKey === key;
    const bancoOk = state?.lastImport?.persistedIn === 'banco' && rowCount > 0;

    if (sameFileAlreadyProcessed && bancoOk) return null;

    return await importRelatorioSpreadsheet({
      filePath: latest.filePath,
      originalName: latest.name,
      source: sameFileAlreadyProcessed ? 'auto-repair' : 'watcher'
    });
  } finally {
    watcherBusy = false;
  }
}

export function startRelatorioImportWatcher() {
  if (watcherHandle) return watcherHandle;
  ensureDir(importDir);

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
    ensureDir(importDir);
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
      return cb(new Error('Formato inválido. Envie .ods, .csv ou .json.'));
    }
    cb(null, true);
  }
});

export function getImportDirectory() {
  ensureDir(importDir);
  return importDir;
}


export async function getRelatorioImportRowCount() {
  return getImportedRowCount();
}
