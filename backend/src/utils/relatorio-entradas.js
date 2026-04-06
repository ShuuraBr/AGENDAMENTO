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
const stateFile = path.join(dataDir, 'importacao-relatorio-state.json');

const SUPPORTED_EXTENSIONS = new Set(['.ods', '.csv', '.json']);
const TABLE_NAME = 'RelatorioTerceirizado';
let watcherHandle = null;
let watcherBusy = false;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function xmlUnescape(value = '') {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function slugify(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase() || 'SEM-CHAVE';
}

function trimTrailingEmpty(cells = []) {
  const output = [...cells];
  while (output.length && `${output[output.length - 1] ?? ''}`.trim() === '') output.pop();
  return output;
}

function parseNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\s+/g, '');
  if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(normalized)) {
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }
  if (/^-?[\d.]+,\d+$/.test(normalized)) {
    const num = Number(normalized.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(num) ? num : 0;
  }
  if (/^-?[\d,]+\.\d+$/.test(normalized)) {
    const num = Number(normalized.replace(/,/g, ''));
    return Number.isFinite(num) ? num : 0;
  }
  if (/^-?[\d.]+$/.test(normalized)) {
    const parts = normalized.split('.');
    if (parts.length > 2) return Number(parts.join('')) || 0;
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }
  const num = Number(normalized.replace(/[^\d,.-]/g, '').replace(/\.(?=.*\.)/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

function toFixedNumber(value, decimals = 3) {
  return Number(Number(value || 0).toFixed(decimals));
}

function buildNoteObservation(entry = {}) {
  const parts = [];
  if (entry.entrada) parts.push(`Entrada ${entry.entrada}`);
  if (entry.dataEmissao) parts.push(`Emissão ${entry.dataEmissao}`);
  if (entry.dataEntrada) parts.push(`Entrada ERP ${entry.dataEntrada}`);
  if (entry.tipoCustoEntrada) parts.push(`Tipo ${entry.tipoCustoEntrada}`);
  return parts.join(' | ');
}

function mapRecordFromRow(row = {}) {
  const fornecedor = String(row['Fornecedor'] || '').trim();
  const numeroNf = String(row['Nr. nota'] || '').trim();
  if (!fornecedor || !numeroNf) return null;

  return {
    entrada: String(row['Entrada'] || '').trim(),
    fornecedor,
    numeroNf,
    serie: String(row['Série'] || row['Serie'] || '').trim(),
    dataEmissao: String(row['Data emissão'] || '').trim(),
    dataEntrada: String(row['Data de Entrada'] || '').trim(),
    dataPrimeiroVencimento: String(row['Data 1º vencimento'] || row['Data 1o vencimento'] || '').trim(),
    tipoCustoEntrada: String(row['Tipo custo entrada'] || '').trim(),
    valorNf: toFixedNumber(parseNumber(row['Valor da nota']), 2),
    valorDesconto: toFixedNumber(parseNumber(row['Valor desconto']), 2),
    qtdItens: Number(parseNumber(row['Qtd. itens']) || 0),
    valorProdutos: toFixedNumber(parseNumber(row['Valor produtos']), 2),
    totalFrete: toFixedNumber(parseNumber(row['Total frete']), 2),
    volumeTotal: toFixedNumber(parseNumber(row['Volume total']), 3),
    pesoTotal: toFixedNumber(parseNumber(row['Peso total']), 3),
    outrasDespesas: toFixedNumber(parseNumber(row['Outras desp.']), 2),
    totalEntradas: toFixedNumber(parseNumber(row['Total entradas'] || row['Valor da nota']), 2),
    status: String(row['Status'] || '').trim(),
    empresa: String(row['Empresa'] || '').trim(),
    dataCadastro: String(row['Data do cadastro'] || '').trim(),
    transportadora: String(row['Transportadora'] || '').trim(),
    numeroCte: String(row['Número do CT-e'] || '').trim(),
  };
}

function normalizeImportedItems(records = []) {
  const groups = new Map();
  for (const record of records) {
    const normalized = mapRecordFromRow(record);
    if (!normalized) continue;
    const key = slugify(normalized.fornecedor);
    const note = {
      numeroNf: normalized.numeroNf,
      serie: normalized.serie,
      volumes: normalized.volumeTotal,
      peso: normalized.pesoTotal,
      valorNf: normalized.valorNf,
      observacao: buildNoteObservation(normalized)
    };
    if (!groups.has(key)) {
      groups.set(key, {
        id: groups.size + 1,
        fornecedor: normalized.fornecedor,
        transportadora: normalized.transportadora || null,
        notas: [],
        notasFiscais: [],
        quantidadeNotas: 0,
        quantidadeVolumes: 0,
        pesoTotalKg: 0,
        valorTotalNf: 0,
        status: 'AGUARDANDO_CHEGADA',
        statusRelatorio: 'Aguardando Chegada',
        referenciaExterna: `PLANILHA-${key}`
      });
    }
    const current = groups.get(key);
    if (!current.transportadora && normalized.transportadora) current.transportadora = normalized.transportadora;
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
  const headers = parseCsvLine(lines[0], delimiter);
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] ?? '';
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
    const rowValues = trimTrailingEmpty(cells);
    for (let i = 0; i < repeatRows; i += 1) rows.push([...rowValues]);
  }

  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell).trim() === 'Fornecedor') && row.some((cell) => String(cell).trim().includes('Nr. nota')));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex];
  return rows.slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell || '').trim() !== ''))
    .map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        if (String(header || '').trim()) item[String(header).trim()] = row[index] ?? '';
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

async function ensureRelatorioTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      fornecedor VARCHAR(255) NOT NULL,
      transportadora VARCHAR(255) NULL,
      motorista VARCHAR(255) NULL,
      cpfMotorista VARCHAR(32) NULL,
      placa VARCHAR(32) NULL,
      quantidadeNotas INT NOT NULL DEFAULT 0,
      quantidadeVolumes DECIMAL(18,3) NOT NULL DEFAULT 0,
      pesoTotalKg DECIMAL(18,3) NOT NULL DEFAULT 0,
      valorTotalNf DECIMAL(18,2) NOT NULL DEFAULT 0,
      notasJson LONGTEXT NULL,
      status VARCHAR(64) NOT NULL DEFAULT 'AGUARDANDO_CHEGADA',
      referenciaExterna VARCHAR(191) NOT NULL UNIQUE,
      agendamentoId INT NULL,
      origemArquivo VARCHAR(255) NULL,
      importedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_relatorio_status (status),
      INDEX idx_relatorio_fornecedor (fornecedor),
      INDEX idx_relatorio_agendamento (agendamentoId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function replaceDatabaseSnapshot(groups = [], sourceFileName = '') {
  await ensureRelatorioTable();
  await prisma.$executeRawUnsafe(`DELETE FROM ${TABLE_NAME} WHERE agendamentoId IS NULL`);
  for (const group of groups) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${TABLE_NAME}
        (fornecedor, transportadora, quantidadeNotas, quantidadeVolumes, pesoTotalKg, valorTotalNf, notasJson, status, referenciaExterna, origemArquivo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        fornecedor = VALUES(fornecedor),
        transportadora = VALUES(transportadora),
        quantidadeNotas = VALUES(quantidadeNotas),
        quantidadeVolumes = VALUES(quantidadeVolumes),
        pesoTotalKg = VALUES(pesoTotalKg),
        valorTotalNf = VALUES(valorTotalNf),
        notasJson = VALUES(notasJson),
        status = VALUES(status),
        origemArquivo = VALUES(origemArquivo),
        importedAt = CURRENT_TIMESTAMP`,
      group.fornecedor,
      group.transportadora,
      Number(group.quantidadeNotas || 0),
      Number(group.quantidadeVolumes || 0),
      Number(group.pesoTotalKg || 0),
      Number(group.valorTotalNf || 0),
      JSON.stringify(group.notas || []),
      group.status || 'AGUARDANDO_CHEGADA',
      group.referenciaExterna,
      sourceFileName || null
    );
  }
}

export async function listFornecedoresPendentesImportados() {
  try {
    await ensureRelatorioTable();
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, fornecedor, transportadora, quantidadeNotas, quantidadeVolumes, pesoTotalKg, valorTotalNf, notasJson, status, referenciaExterna, origemArquivo, importedAt, updatedAt
         FROM ${TABLE_NAME}
        WHERE agendamentoId IS NULL
        ORDER BY fornecedor ASC, id DESC`
    );
    if (Array.isArray(rows) && rows.length) {
      return rows.map((row) => ({
        id: Number(row.id || 0),
        fornecedor: String(row.fornecedor || ''),
        transportadora: row.transportadora ? String(row.transportadora) : null,
        quantidadeNotas: Number(row.quantidadeNotas || 0),
        quantidadeVolumes: Number(row.quantidadeVolumes || 0),
        pesoTotalKg: Number(row.pesoTotalKg || 0),
        valorTotalNf: Number(row.valorTotalNf || 0),
        status: String(row.status || 'AGUARDANDO_CHEGADA'),
        statusRelatorio: 'Aguardando Chegada',
        referenciaExterna: String(row.referenciaExterna || ''),
        origemArquivo: row.origemArquivo ? String(row.origemArquivo) : null,
        importedAt: row.importedAt || null,
        updatedAt: row.updatedAt || null,
        notas: (() => {
          try { return JSON.parse(row.notasJson || '[]'); } catch { return []; }
        })(),
        notasFiscais: (() => {
          try { return JSON.parse(row.notasJson || '[]'); } catch { return []; }
        })()
      }));
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
  const groups = normalizeImportedItems(rows);
  if (!groups.length) throw new Error('Nenhum fornecedor com NF válida foi encontrado na planilha.');

  let persistedIn = 'arquivo';
  try {
    await replaceDatabaseSnapshot(groups, originalName || path.basename(filePath));
    persistedIn = 'banco';
  } catch (error) {
    console.error('Falha ao persistir planilha no banco. Mantendo fallback em arquivo:', error?.message || error);
  }

  writeFallback(groups);
  const summary = {
    ok: true,
    totalFornecedores: groups.length,
    totalNotas: groups.reduce((acc, item) => acc + Number(item.quantidadeNotas || 0), 0),
    totalPesoKg: toFixedNumber(groups.reduce((acc, item) => acc + Number(item.pesoTotalKg || 0), 0), 3),
    totalValorNf: toFixedNumber(groups.reduce((acc, item) => acc + Number(item.valorTotalNf || 0), 0), 2),
    persistedIn,
    source,
    fileName: originalName || path.basename(filePath),
    importedAt: new Date().toISOString()
  };

  writeState({
    ...readState(),
    lastImport: summary,
    lastProcessedKey: `${summary.fileName}:${fs.statSync(filePath).mtimeMs}:${fs.statSync(filePath).size}`
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
    if (state.lastProcessedKey === key) return null;
    return await importRelatorioSpreadsheet({ filePath: latest.filePath, originalName: latest.name, source: 'watcher' });
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
  }, 60 * 1000);
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
