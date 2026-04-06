import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';

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

export function maskCpf(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '-';
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)}.***.***-${digits.slice(-2)}`;
}

function normalizeRecord(record = {}) {
  if (!record) return null;
  return {
    id: Number(record.id || 0) || null,
    agendamentoId: Number(record.agendamentoId || 0) || null,
    token: String(record.token || '').trim(),
    protocolo: String(record.protocolo || '').trim(),
    fornecedor: String(record.fornecedor || '').trim(),
    transportadora: String(record.transportadora || '').trim(),
    motorista: String(record.motorista || '').trim(),
    cpfMotorista: String(record.cpfMotorista || '').trim(),
    placa: String(record.placa || '').trim(),
    dataAgendada: String(record.dataAgendada || '').trim(),
    horaAgendada: String(record.horaAgendada || '').trim(),
    emailMotorista: String(record.emailMotorista || '').trim(),
    atendimentoNota: record.atendimentoNota == null || record.atendimentoNota === '' ? null : Number(record.atendimentoNota),
    equipeNota: record.equipeNota == null || record.equipeNota === '' ? null : Number(record.equipeNota),
    rapidezNota: record.rapidezNota == null || record.rapidezNota === '' ? null : Number(record.rapidezNota),
    processoTranquilo: String(record.processoTranquilo || '').trim(),
    comentario: String(record.comentario || '').trim(),
    respondeu: Boolean(Number(record.respondeu || 0)),
    respondeuEm: record.respondeuEm || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null
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
      return normalizeRecord(existing[0]);
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
    return normalizeRecord(created?.[0] || record);
  } catch {
    const items = readFileRecords();
    const existing = items.find((item) => Number(item.agendamentoId) === Number(agendamento.id));
    if (existing) return normalizeRecord(existing);

    const record = { id: nextId(items), ...recordFromAgendamento(agendamento) };
    items.unshift(record);
    writeFileRecords(items);
    return normalizeRecord(record);
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
    return rows?.[0] ? normalizeRecord(rows[0]) : null;
  } catch {
    return normalizeRecord(readFileRecords().find((item) => String(item.token) === normalizedToken) || null);
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
