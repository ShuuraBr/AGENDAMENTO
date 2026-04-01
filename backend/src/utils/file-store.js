import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateTotals } from './agendamento-helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

function filePath(name) {
  return path.join(dataDir, name);
}

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function readJsonFile(name, fallback = []) {
  try {
    const file = filePath(name);
    if (!fs.existsSync(file)) return Array.isArray(fallback) ? [...fallback] : { ...fallback };
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return Array.isArray(fallback) ? [...fallback] : { ...fallback };
  }
}

function writeJsonFile(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

function nextId(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
}

export function readUsuarios() { return readJsonFile('usuarios.json', []); }
export function readAgendamentos() { return readJsonFile('agendamentos.json', []).map(enrichAgendamentoRecord); }
export function writeAgendamentos(items) { return writeJsonFile('agendamentos.json', items); }
export function readDocas() { return readJsonFile('docas.json', []); }
export function readJanelas() { return readJsonFile('janelas.json', []); }
export function readDocumentos() { return readJsonFile('documentos.json', []); }
export function writeDocumentos(items) { return writeJsonFile('documentos.json', items); }
export function readFornecedores() { return readJsonFile('fornecedores.json', []); }
export function readTransportadoras() { return readJsonFile('transportadoras.json', []); }
export function readMotoristas() { return readJsonFile('motoristas.json', []); }
export function readVeiculos() { return readJsonFile('veiculos.json', []); }
export function readRegras() { return readJsonFile('regras.json', []); }
export function readFornecedoresPendentes() { return readJsonFile('fornecedores-pendentes.json', []); }

export function enrichAgendamentoRecord(item = {}) {
  const notas = Array.isArray(item.notasFiscais) ? item.notasFiscais : [];
  return {
    ...item,
    notasFiscais: notas,
    documentos: Array.isArray(item.documentos) ? item.documentos : [],
    ...calculateTotals(notas, item)
  };
}

export function createAgendamentoFile(data) {
  const items = readAgendamentos();
  const id = nextId(items);
  const record = enrichAgendamentoRecord({
    id,
    status: 'PENDENTE_APROVACAO',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data
  });
  items.unshift(record);
  writeAgendamentos(items);
  return record;
}

export function updateAgendamentoFile(id, patch) {
  const items = readAgendamentos();
  const index = items.findIndex((item) => Number(item.id) === Number(id));
  if (index < 0) return null;
  items[index] = enrichAgendamentoRecord({ ...items[index], ...patch, updatedAt: new Date().toISOString() });
  writeAgendamentos(items);
  return items[index];
}

export function findAgendamentoFile(id) {
  return readAgendamentos().find((item) => Number(item.id) === Number(id)) || null;
}

export function findAgendamentoByTokenFile(token) {
  return readAgendamentos().find((item) => [item.publicTokenFornecedor, item.publicTokenMotorista, item.checkinToken, item.checkoutToken].includes(token)) || null;
}

export function addDocumentoFile(data) {
  const docs = readDocumentos();
  const item = { id: nextId(docs), createdAt: new Date().toISOString(), ...data };
  docs.unshift(item);
  writeDocumentos(docs);
  return item;
}

export function addNotaFile(agendamentoId, nota) {
  const found = findAgendamentoFile(agendamentoId);
  if (!found) return null;
  const notas = Array.isArray(found.notasFiscais) ? [...found.notasFiscais] : [];
  notas.push({ id: nextId(notas), ...nota, createdAt: new Date().toISOString() });
  return updateAgendamentoFile(agendamentoId, { notasFiscais: notas });
}

export function buildDocaPainelFromFiles(dataAgendada = null) {
  const docas = readDocas();
  const agendamentos = readAgendamentos().filter((item) => !dataAgendada || String(item.dataAgendada) === String(dataAgendada));
  const priority = { CHEGOU: 1, APROVADO: 2, PENDENTE_APROVACAO: 3, EM_DESCARGA: 4, FINALIZADO: 5, CANCELADO: 6, REPROVADO: 7, NO_SHOW: 8 };
  const color = (status) => {
    if (["EM_DESCARGA", "CHEGOU"].includes(status)) return 'VERDE';
    if (["APROVADO", "PENDENTE_APROVACAO"].includes(status)) return 'AMARELO';
    return 'VERMELHO';
  };

  return docas.map((doca) => {
    const fila = agendamentos
      .filter((a) => String(a.docaId || a.doca || '') === String(doca.id) || String(a.doca || '') === String(doca.codigo))
      .sort((a, b) => {
        const pa = priority[a.status] ?? 99;
        const pb = priority[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada || '').localeCompare(String(b.horaAgendada || ''));
      });
    const ativo = fila.find((a) => ['CHEGOU', 'EM_DESCARGA'].includes(a.status)) || fila[0] || null;
    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao || '',
      ocupacaoAtual: ativo ? ativo.status : 'LIVRE',
      semaforo: ativo ? color(ativo.status) : 'VERDE',
      fila,
    };
  });
}
