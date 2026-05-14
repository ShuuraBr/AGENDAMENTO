import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '../../data/notificacoes.json');

function readAll() {
  try {
    if (!fs.existsSync(FILE)) return [];
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(items) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2), 'utf8');
}

function nextId(items) {
  return items.reduce((max, n) => Math.max(max, Number(n.id || 0)), 0) + 1;
}

export function createNotificacao({ tipo, agendamentoId, protocolo, fornecedor, dataAgendadaOriginal, requestedBy, targetPerfis = ['OPERADOR', 'ADMIN'] }) {
  const items = readAll();
  const notif = {
    id: nextId(items),
    tipo,
    agendamentoId,
    protocolo,
    fornecedor,
    dataAgendadaOriginal,
    requestedBy,
    targetPerfis,
    lidaPor: [],
    createdAt: new Date().toISOString()
  };
  items.unshift(notif);
  writeAll(items);
  return notif;
}

export function listNotificacoes({ perfil } = {}) {
  const all = readAll();
  if (!perfil) return all;
  return all.filter((n) => Array.isArray(n.targetPerfis) && n.targetPerfis.includes(perfil));
}

export function markLida(id, usuarioId) {
  const items = readAll();
  const idx = items.findIndex((n) => String(n.id) === String(id));
  if (idx < 0) return null;
  const lidaPor = Array.isArray(items[idx].lidaPor) ? items[idx].lidaPor : [];
  if (!lidaPor.includes(String(usuarioId))) lidaPor.push(String(usuarioId));
  items[idx] = { ...items[idx], lidaPor };
  writeAll(items);
  return items[idx];
}

export function findNotificacao(id) {
  return readAll().find((n) => String(n.id) === String(id)) || null;
}

export function deleteNotificacao(id) {
  const items = readAll().filter((n) => String(n.id) !== String(id));
  writeAll(items);
}
