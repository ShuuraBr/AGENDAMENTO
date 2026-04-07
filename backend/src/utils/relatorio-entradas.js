import crypto from 'crypto';
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

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
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
      rowHash VARCHAR(64) NULL,
      agendamentoId INT NULL,
      ${businessColumnsSql},
      origemArquivo VARCHAR(255) NULL,
      importedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      dadosOriginaisJson LONGTEXT NULL,
      UNIQUE KEY uk_relatorio_row_hash (rowHash),
      INDEX idx_relatorio_agendamento (agendamentoId),
      INDEX idx_relatorio_fornecedor (${quoteIdentifier('Fornecedor')}(191)),
      INDEX idx_relatorio_nf (${quoteIdentifier('Nr. nota')}(191)),
      INDEX idx_relatorio_status (${quoteIdentifier('Status')}(191))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const existingColumns = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
  const existingNames = new Set((existingColumns || []).map((item) => String(item.Field || '')));

  if (!existingNames.has('rowHash')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN rowHash VARCHAR(64) NULL`);
  }
  if (!existingNames.has('agendamentoId')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE ${quoteIdentifier(TABLE_NAME)} ADD COLUMN agendamentoId INT NULL`);
  }

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

  try {
    await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX uk_relatorio_row_hash ON ${quoteIdentifier(TABLE_NAME)} (rowHash)`);
  } catch {}
  try {
    await prisma.$executeRawUnsafe(`CREATE INDEX idx_relatorio_agendamento ON ${quoteIdentifier(TABLE_NAME)} (agendamentoId)`);
  } catch {}
}


async function countRelatorioRowsInDatabase() {
  await ensureRelatorioTable();
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(TABLE_NAME)}`);
  const total = Number(rows?.[0]?.total ?? rows?.[0]?.['COUNT(*)'] ?? 0);
  return Number.isFinite(total) ? total : 0;
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
  const shouldImport = !sameFileAlreadyProcessed || (forceWhenDatabaseEmpty && totalLinhasNoBanco === 0);

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
  await ensureRelatorioTable();

  const existingRows = await prisma.$queryRawUnsafe(`SELECT rowHash, agendamentoId FROM ${quoteIdentifier(TABLE_NAME)} WHERE rowHash IS NOT NULL`);
  const agendamentoMap = new Map((existingRows || []).map((row) => [String(row.rowHash || ''), row.agendamentoId == null ? null : Number(row.agendamentoId)]));

  await prisma.$executeRawUnsafe(`DELETE FROM ${quoteIdentifier(TABLE_NAME)}`);

  const columns = ['rowHash', 'agendamentoId', ...SHEET_COLUMNS, 'origemArquivo', 'dadosOriginaisJson'];
  const columnSql = columns.map((column) => quoteIdentifier(column)).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  for (const row of rows) {
    const normalizedRow = {};
    for (const column of SHEET_COLUMNS) normalizedRow[column] = normalizeCellValue(row[column] ?? '');
    const rowHash = buildRowHash(normalizedRow);
    const values = [rowHash, agendamentoMap.get(rowHash) ?? null, ...SHEET_COLUMNS.map((column) => normalizedRow[column]), sourceFileName || null, JSON.stringify(normalizedRow)];
    await prisma.$executeRawUnsafe(`INSERT INTO ${quoteIdentifier(TABLE_NAME)} (${columnSql}) VALUES (${placeholders})`, ...values);
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

export async function listFornecedoresPendentesImportados() {
  try {
    await ensureRelatorioTable();
    const existingColumns = await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM ${quoteIdentifier(TABLE_NAME)}`);
    const existingNames = new Set((existingColumns || []).map((item) => String(item.Field || '')));

    const orderBy = [];
    if (existingNames.has('Fornecedor')) orderBy.push(`${quoteIdentifier('Fornecedor')} ASC`);
    if (existingNames.has('Nr. nota')) orderBy.push(`${quoteIdentifier('Nr. nota')} ASC`);
    if (existingNames.has('Série')) orderBy.push(`${quoteIdentifier('Série')} ASC`);
    if (existingNames.has('importedAt')) orderBy.push(`importedAt ASC`);
    if (existingNames.has('updatedAt')) orderBy.push(`updatedAt ASC`);
    if (existingNames.has('id')) orderBy.push(`id ASC`);

    const whereParts = [];
    if (existingNames.has('agendamentoId')) whereParts.push('agendamentoId IS NULL');
    const sql = `SELECT * FROM ${quoteIdentifier(TABLE_NAME)}${whereParts.length ? ` WHERE ${whereParts.join(' AND ')}` : ''}${orderBy.length ? ` ORDER BY ${orderBy.join(', ')}` : ''}`;
    const rows = await prisma.$queryRawUnsafe(sql);

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

export async function linkRelatorioRowsToAgendamento(agendamentoId, fornecedor, notas = []) {
  if (!agendamentoId || !fornecedor || !Array.isArray(notas) || !notas.length) return;
  await ensureRelatorioTable();

  for (const nota of notas) {
    const numeroNf = normalizeCellValue(nota?.numeroNf || nota?.numero_nf || '');
    const serie = normalizeCellValue(nota?.serie || '');
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

  console.log(`[IMPORTACAO_RELATORIO] arquivo=${summary.fileName} validas=${summary.totalLinhasValidas} fornecedores=${summary.totalFornecedores} persistedIn=${summary.persistedIn}`);
  return summary;
}

export function getRelatorioImportStatus() {
  return readState().lastImport || null;
}

export function getRelatorioImportStatusDetailed() {
  const state = readState();
  return {
    ultimoProcessamento: state.lastImport || null,
    lastProcessedKey: state.lastProcessedKey || null,
    pastasMonitoradas: [...importDirCandidates]
  };
}


export async function getRelatorioRowsCount() {
  try {
    await ensureRelatorioTable();
    const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(TABLE_NAME)}`);
    const total = Number(result?.[0]?.total || result?.[0]?.TOTAL || 0);
    return Number.isFinite(total) ? total : 0;
  } catch (error) {
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

  const key = `${latest.name}:${latest.mtimeMs}:${latest.size}`;
  const state = readState();
  const totalLinhasNoBanco = await getRelatorioRowsCount();
  const shouldReimport = state.lastProcessedKey !== key || (forceIfEmpty && totalLinhasNoBanco === 0);

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
        const key = `${pathToDisplayName(nameBuffer)}:${stats.size}:${stats.mtimeMs}`;
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
      return cb(new Error('Formato inválido. Envie .ods, .csv ou .json.'));
    }
    cb(null, true);
  }
});

export function getImportDirectory() {
  for (const dir of importDirCandidates) ensureDir(dir);
  return importDir;
}
