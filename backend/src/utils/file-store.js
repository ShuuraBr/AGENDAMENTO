import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateTotals } from './agendamento-helpers.js';
import { normalizeAgendamentoNota } from './nota-metadata.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');
const DOCA_OCCUPYING_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function occupiesDoca(status) {
  return DOCA_OCCUPYING_STATUSES.includes(String(status || ""));
}

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
export function readAuditLogs() { return readJsonFile('logs-auditoria.json', []); }
export function writeAuditLogs(items) { return writeJsonFile('logs-auditoria.json', items); }
export function readFornecedores() { return readJsonFile('fornecedores.json', []); }
export function readTransportadoras() { return readJsonFile('transportadoras.json', []); }
export function readMotoristas() { return readJsonFile('motoristas.json', []); }
export function readVeiculos() { return readJsonFile('veiculos.json', []); }
export function readRegras() { return readJsonFile('regras.json', []); }
function normalizePendingNota(item = {}) {
  return normalizeAgendamentoNota({
    ...item,
    numeroNf: String(item?.numeroNf ?? item?.numero_nf ?? item?.notaFiscal ?? item?.nota_fiscal ?? item?.["Nr. Nota"] ?? item?.["NR NOTA"] ?? item?.["NF"] ?? '').trim(),
    serie: String(item?.serie ?? item?.serieNf ?? item?.serie_nf ?? item?.["Série"] ?? item?.["Serie"] ?? item?.["SERIE"] ?? '').trim(),
    chaveAcesso: String(item?.chaveAcesso ?? item?.chave_acesso ?? item?.["Chave de acesso"] ?? '').trim(),
    volumes: Number(item?.volumes ?? item?.volume ?? item?.["Volumes"] ?? 0),
    peso: Number(item?.peso ?? item?.["Peso"] ?? 0),
    valorNf: Number(item?.valorNf ?? item?.valor_nf ?? item?.valor ?? item?.["Valor da nota"] ?? 0),
    observacao: String(item?.observacao ?? item?.observações ?? item?.["Observação"] ?? '').trim()
  });
}

export function readFornecedoresPendentes() {
  return readJsonFile('fornecedores-pendentes.json', []).map((item) => {
    const notasRaw = Array.isArray(item?.notas) ? item.notas : Array.isArray(item?.notasFiscais) ? item.notasFiscais : [];
    const notas = notasRaw.map(normalizePendingNota).filter((nota) => nota.numeroNf || nota.chaveAcesso);
    return {
      ...item,
      notas,
      notasFiscais: notas,
      quantidadeNotas: Number(item?.quantidadeNotas ?? notas.length ?? 0),
      quantidadeVolumes: Number(item?.quantidadeVolumes ?? notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0)),
      pesoTotalKg: Number(item?.pesoTotalKg ?? notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0)),
      valorTotalNf: Number(item?.valorTotalNf ?? notas.reduce((acc, nota) => acc + Number(nota?.valorNf || 0), 0))
    };
  });
}

export function enrichAgendamentoRecord(item = {}) {
  const notas = Array.isArray(item.notasFiscais) ? item.notasFiscais : [];
  const docas = readJsonFile('docas.json', []);
  const janelas = readJsonFile('janelas.json', []);
  const docaRelacionada = docas.find((doca) => String(doca.id) === String(item.docaId || item.doca?.id || '')) || null;
  const janelaRelacionada = janelas.find((janela) => String(janela.id) === String(item.janelaId || item.janela?.id || '')) || null;
  return {
    ...item,
    doca: typeof item.doca === 'object' && item.doca ? item.doca : (docaRelacionada ? { ...docaRelacionada } : item.doca),
    janela: typeof item.janela === 'object' && item.janela ? item.janela : (janelaRelacionada ? { ...janelaRelacionada } : item.janela),
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
  const priority = { CHEGOU: 1, EM_DESCARGA: 2, APROVADO: 3, PENDENTE_APROVACAO: 4 };
  const color = (status) => {
    if (["EM_DESCARGA", "CHEGOU"].includes(status)) return 'VERDE';
    if (["APROVADO", "PENDENTE_APROVACAO"].includes(status)) return 'AMARELO';
    return 'VERDE';
  };

  return docas.map((doca) => {
    const fila = agendamentos
      .filter((a) => (String(a.docaId || a.doca || '') === String(doca.id) || String(a.doca || '') === String(doca.codigo)) && occupiesDoca(a.status))
      .sort((a, b) => {
        const pa = priority[a.status] ?? 99;
        const pb = priority[b.status] ?? 99;
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada || '').localeCompare(String(b.horaAgendada || ''));
      });
    const filaDetalhada = fila.map((item) => {
      const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais : [];
      const destinos = [...new Set(notas.map((nota) => String(nota?.destino || nota?.empresa || '').trim()).filter(Boolean))];
      const totalItens = notas.reduce((acc, nota) => acc + Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0), 0);
      return {
        ...item,
        totalNotas: Number(item?.quantidadeNotas || notas.length || 0),
        totalVolumes: Number(item?.quantidadeVolumes || notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0) || 0),
        pesoTotalKg: Number(item?.pesoTotalKg || notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0) || 0),
        totalItens,
        destinos,
        notasDetalhes: notas.map((nota) => ({
          numeroNf: String(nota?.numeroNf || '').trim(),
          serie: String(nota?.serie || '').trim(),
          destino: String(nota?.destino || nota?.empresa || '').trim(),
          peso: Number(nota?.peso || 0),
          volumes: Number(nota?.volumes || 0),
          itens: Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0)
        }))
      };
    });
    const ativo = filaDetalhada.find((a) => ['CHEGOU', 'EM_DESCARGA'].includes(a.status)) || filaDetalhada[0] || null;
    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao || '',
      ocupacaoAtual: ativo ? ativo.status : 'LIVRE',
      semaforo: ativo ? color(ativo.status) : 'VERDE',
      fila: filaDetalhada,
    };
  });
}


function cadastroFileName(tipo = '') {
  const map = {
    fornecedores: 'fornecedores.json',
    transportadoras: 'transportadoras.json',
    motoristas: 'motoristas.json',
    veiculos: 'veiculos.json',
    docas: 'docas.json',
    janelas: 'janelas.json',
    regras: 'regras.json',
    usuarios: 'usuarios.json'
  };
  return map[String(tipo)] || null;
}

export function readCadastroFile(tipo) {
  const name = cadastroFileName(tipo);
  if (!name) return [];
  return readJsonFile(name, []);
}

export function upsertCadastroFile(tipo, payload = {}, id = null) {
  const name = cadastroFileName(tipo);
  if (!name) throw new Error('Tipo inválido.');
  const items = readJsonFile(name, []);
  if (id != null) {
    const index = items.findIndex((item) => Number(item.id) == Number(id));
    if (index < 0) throw new Error('Registro não encontrado.');
    items[index] = { ...items[index], ...payload, id: Number(id), updatedAt: new Date().toISOString() };
    writeJsonFile(name, items);
    return items[index];
  }
  const item = { id: nextId(items), ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  items.unshift(item);
  writeJsonFile(name, items);
  return item;
}
