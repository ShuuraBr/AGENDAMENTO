import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { readAgendamentos } from './file-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');
const feedbackFile = path.join(dataDir, 'avaliacoes-motoristas.json');

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readFileRecords() {
  try {
    if (!fs.existsSync(feedbackFile)) return [];
    return JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
  } catch {
    return [];
  }
}

function writeFileRecords(items) {
  ensureDir();
  fs.writeFileSync(feedbackFile, JSON.stringify(items, null, 2), 'utf8');
}

function nextId(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
}

function generateToken() {
  return `AVL-${crypto.randomBytes(12).toString('hex').toUpperCase()}`;
}

function normalizeDateValue(value, fallback = '') {
  const rawValue = value ?? fallback;
  if (!rawValue) return '';
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    const year = String(rawValue.getUTCFullYear());
    const month = String(rawValue.getUTCMonth() + 1).padStart(2, '0');
    const day = String(rawValue.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = String(rawValue).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const year = String(native.getUTCFullYear());
    const month = String(native.getUTCMonth() + 1).padStart(2, '0');
    const day = String(native.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return raw;
}

function normalizeTimeValue(value, fallback = '') {
  const rawValue = value ?? fallback;
  if (!rawValue) return '';
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    const hh = String(rawValue.getUTCHours()).padStart(2, '0');
    const mm = String(rawValue.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const raw = String(rawValue).trim();
  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
  if (match) return match[1];
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const hh = String(native.getUTCHours()).padStart(2, '0');
    const mm = String(native.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return raw;
}

function deriveHoraFromJanela(agendamento = {}) {
  const janelaCodigo = String(agendamento?.janela?.codigo || agendamento?.janela || agendamento?.janelaCodigo || '').trim();
  const match = janelaCodigo.match(/(\d{2}:\d{2})/);
  return match ? match[1] : '';
}


function isMissingScheduleValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || ['-', 'invalid date', 'null', 'undefined'].includes(normalized);
}

function pickFeedbackDateCandidate(source = {}) {
  return source?.dataAgendada ?? source?.data_agendada ?? source?.dataProgramada ?? source?.data_programada ?? source?.data ?? '';
}

function pickFeedbackTimeCandidate(source = {}) {
  return source?.horaAgendada ?? source?.hora_agendada ?? source?.horaProgramada ?? source?.hora_programada ?? source?.hora ?? '';
}

function normalizeFeedbackRecordShape(record = {}, fallback = {}) {
  if (!record) return null;
  const dataAgendada = normalizeDateValue(
    pickFeedbackDateCandidate(record) || pickFeedbackDateCandidate(fallback),
    ''
  );
  const horaAgendada = normalizeTimeValue(
    pickFeedbackTimeCandidate(record) || pickFeedbackTimeCandidate(fallback),
    deriveHoraFromJanela(record) || deriveHoraFromJanela(fallback)
  );
  return {
    ...fallback,
    ...record,
    dataAgendada,
    horaAgendada
  };
}

async function findAgendamentoById(agendamentoId) {
  const numericId = Number(agendamentoId || 0);
  if (!Number.isFinite(numericId) || numericId <= 0) return null;
  try {
    return await prisma.agendamento.findUnique({ where: { id: numericId }, include: { janela: true } });
  } catch {
    return readAgendamentos().find((item) => Number(item?.id || 0) === numericId) || null;
  }
}

async function enrichFeedbackRecord(record = {}) {
  const normalized = normalizeFeedbackRecordShape(record);
  if (!normalized) return null;
  const needsBackfill = isMissingScheduleValue(normalized.dataAgendada) || isMissingScheduleValue(normalized.horaAgendada) || !normalized.emailMotorista;
  if (!needsBackfill) return normalized;
  const agendamento = await findAgendamentoById(normalized.agendamentoId);
  if (!agendamento) return normalized;
  return normalizeFeedbackRecordShape(normalized, agendamento);
}

export function maskCpf(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '-';
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function normalizeRecord(record = {}) {
  if (!record) return null;
  const shaped = normalizeFeedbackRecordShape(record);
  return {
    id: Number(shaped.id || 0) || null,
    agendamentoId: Number(shaped.agendamentoId || 0) || null,
    token: String(shaped.token || '').trim(),
    protocolo: String(shaped.protocolo || '').trim(),
    fornecedor: String(shaped.fornecedor || '').trim(),
    transportadora: String(shaped.transportadora || '').trim(),
    motorista: String(shaped.motorista || '').trim(),
    cpfMotorista: String(shaped.cpfMotorista || '').trim(),
    placa: String(shaped.placa || '').trim(),
    dataAgendada: String(shaped.dataAgendada || '').trim(),
    horaAgendada: String(shaped.horaAgendada || '').trim(),
    emailMotorista: String(shaped.emailMotorista || '').trim(),
    atendimentoNota: shaped.atendimentoNota == null || shaped.atendimentoNota === '' ? null : Number(shaped.atendimentoNota),
    equipeNota: shaped.equipeNota == null || shaped.equipeNota === '' ? null : Number(shaped.equipeNota),
    rapidezNota: shaped.rapidezNota == null || shaped.rapidezNota === '' ? null : Number(shaped.rapidezNota),
    processoTranquilo: String(shaped.processoTranquilo || '').trim(),
    comentario: String(shaped.comentario || '').trim(),
    respondeu: Boolean(Number(shaped.respondeu || 0)),
    respondeuEm: shaped.respondeuEm || null,
    createdAt: shaped.createdAt || null,
    updatedAt: shaped.updatedAt || null
  };
}

async function ensureFeedbackTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS AvaliacaoMotorista (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      agendamentoId INT NOT NULL,
      token VARCHAR(191) NOT NULL UNIQUE,
      protocolo VARCHAR(80) NULL,
      fornecedor VARCHAR(255) NULL,
      transportadora VARCHAR(255) NULL,
      motorista VARCHAR(255) NULL,
      cpfMotorista VARCHAR(32) NULL,
      placa VARCHAR(32) NULL,
      dataAgendada VARCHAR(32) NULL,
      horaAgendada VARCHAR(16) NULL,
      emailMotorista VARCHAR(255) NULL,
      atendimentoNota INT NULL,
      equipeNota INT NULL,
      rapidezNota INT NULL,
      processoTranquilo VARCHAR(32) NULL,
      comentario LONGTEXT NULL,
      respondeu TINYINT(1) NOT NULL DEFAULT 0,
      respondeuEm DATETIME NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_avaliacao_motorista_agendamento (agendamentoId),
      INDEX idx_avaliacao_motorista_respondeu (respondeu)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

function recordFromAgendamento(agendamento, token = generateToken()) {
  return normalizeRecord({
    agendamentoId: agendamento.id,
    token,
    protocolo: agendamento.protocolo,
    fornecedor: agendamento.fornecedor,
    transportadora: agendamento.transportadora,
    motorista: agendamento.motorista,
    cpfMotorista: agendamento.cpfMotorista,
    placa: agendamento.placa,
    dataAgendada: agendamento.dataAgendada,
    horaAgendada: agendamento.horaAgendada,
    emailMotorista: agendamento.emailMotorista,
    respondeu: 0,
    respondeuEm: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export async function ensureFeedbackRequest(agendamento) {
  try {
    await ensureFeedbackTable();
    const existing = await prisma.$queryRawUnsafe(
      'SELECT * FROM AvaliacaoMotorista WHERE agendamentoId = ? ORDER BY id DESC LIMIT 1',
      Number(agendamento.id)
    );
    if (Array.isArray(existing) && existing[0]) {
      const normalizedExisting = await enrichFeedbackRecord(existing[0]);
      if ((isMissingScheduleValue(existing[0]?.dataAgendada) && normalizedExisting?.dataAgendada) || (isMissingScheduleValue(existing[0]?.horaAgendada) && normalizedExisting?.horaAgendada) || (!existing[0]?.emailMotorista && normalizedExisting?.emailMotorista)) {
        await prisma.$executeRawUnsafe(
          'UPDATE AvaliacaoMotorista SET dataAgendada = ?, horaAgendada = ?, emailMotorista = ? WHERE id = ?',
          normalizedExisting.dataAgendada || null,
          normalizedExisting.horaAgendada || null,
          normalizedExisting.emailMotorista || null,
          Number(normalizedExisting.id)
        );
      }
      return normalizedExisting;
    }

    const record = recordFromAgendamento(agendamento);
    await prisma.$executeRawUnsafe(
      `INSERT INTO AvaliacaoMotorista (agendamentoId, token, protocolo, fornecedor, transportadora, motorista, cpfMotorista, placa, dataAgendada, horaAgendada, emailMotorista, respondeu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      record.agendamentoId,
      record.token,
      record.protocolo,
      record.fornecedor,
      record.transportadora,
      record.motorista,
      record.cpfMotorista,
      record.placa,
      record.dataAgendada,
      record.horaAgendada,
      record.emailMotorista
    );

    const created = await prisma.$queryRawUnsafe(
      'SELECT * FROM AvaliacaoMotorista WHERE token = ? LIMIT 1',
      record.token
    );
    return await enrichFeedbackRecord(created?.[0] || record);
  } catch {
    const items = readFileRecords();
    const existing = items.find((item) => Number(item.agendamentoId) === Number(agendamento.id));
    if (existing) {
      const normalizedExisting = await enrichFeedbackRecord(existing);
      if ((isMissingScheduleValue(existing?.dataAgendada) && normalizedExisting?.dataAgendada) || (isMissingScheduleValue(existing?.horaAgendada) && normalizedExisting?.horaAgendada) || (!existing?.emailMotorista && normalizedExisting?.emailMotorista)) {
        const index = items.findIndex((item) => Number(item?.id || 0) === Number(existing.id || 0));
        if (index >= 0) {
          items[index] = { ...items[index], dataAgendada: normalizedExisting.dataAgendada, horaAgendada: normalizedExisting.horaAgendada, emailMotorista: normalizedExisting.emailMotorista };
          writeFileRecords(items);
        }
      }
      return normalizedExisting;
    }

    const record = { id: nextId(items), ...recordFromAgendamento(agendamento) };
    items.unshift(record);
    writeFileRecords(items);
    return await enrichFeedbackRecord(record);
  }
}

export async function getFeedbackRequestByToken(token) {
  const normalizedToken = String(token || '').trim();
  if (!normalizedToken) return null;

  try {
    await ensureFeedbackTable();
    const rows = await prisma.$queryRawUnsafe(
      'SELECT * FROM AvaliacaoMotorista WHERE token = ? LIMIT 1',
      normalizedToken
    );
    return rows?.[0] ? await enrichFeedbackRecord(rows[0]) : null;
  } catch {
    return await enrichFeedbackRecord(readFileRecords().find((item) => String(item.token) === normalizedToken) || null);
  }
}

function validateScore(name, value) {
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1 || num > 5) {
    throw new Error(`${name} deve ser uma nota entre 1 e 5.`);
  }
  return num;
}

function validatePayload(payload = {}) {
  const processo = String(payload.processoTranquilo || '').trim().toUpperCase();
  if (!['SIM', 'PARCIAL', 'NAO'].includes(processo)) {
    throw new Error('Informe se o processo correu tranquilo: SIM, PARCIAL ou NAO.');
  }

  return {
    atendimentoNota: validateScore('Atendimento geral', payload.atendimentoNota),
    equipeNota: validateScore('Equipe de recebimento', payload.equipeNota),
    rapidezNota: validateScore('Rapidez e eficácia', payload.rapidezNota),
    processoTranquilo: processo,
    comentario: String(payload.comentario || '').trim().slice(0, 4000)
  };
}

export async function submitFeedbackByToken(token, payload = {}) {
  const normalizedToken = String(token || '').trim();
  const data = validatePayload(payload);

  try {
    await ensureFeedbackTable();
    const rows = await prisma.$queryRawUnsafe(
      'SELECT * FROM AvaliacaoMotorista WHERE token = ? LIMIT 1',
      normalizedToken
    );
    const current = rows?.[0] ? normalizeRecord(rows[0]) : null;
    if (!current) return { ok: false, reason: 'not_found' };
    if (current.respondeu) return { ok: false, reason: 'already_submitted', record: current };

    await prisma.$executeRawUnsafe(
      `UPDATE AvaliacaoMotorista
          SET atendimentoNota = ?, equipeNota = ?, rapidezNota = ?, processoTranquilo = ?, comentario = ?, respondeu = 1, respondeuEm = NOW()
        WHERE token = ?`,
      data.atendimentoNota,
      data.equipeNota,
      data.rapidezNota,
      data.processoTranquilo,
      data.comentario,
      normalizedToken
    );

    const updated = await prisma.$queryRawUnsafe(
      'SELECT * FROM AvaliacaoMotorista WHERE token = ? LIMIT 1',
      normalizedToken
    );
    return { ok: true, record: normalizeRecord(updated?.[0] || { ...current, ...data, respondeu: true, respondeuEm: new Date().toISOString() }) };
  } catch {
    const items = readFileRecords();
    const index = items.findIndex((item) => String(item.token) === normalizedToken);
    if (index < 0) return { ok: false, reason: 'not_found' };
    if (items[index]?.respondeu) return { ok: false, reason: 'already_submitted', record: normalizeRecord(items[index]) };
    items[index] = normalizeRecord({
      ...items[index],
      ...data,
      respondeu: 1,
      respondeuEm: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeFileRecords(items);
    return { ok: true, record: normalizeRecord(items[index]) };
  }
}
