import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '../../data');

function readJsonFile(name, fallback = []) {
  try {
    const file = path.join(dataDir, name);
    if (!fs.existsSync(file)) return Array.isArray(fallback) ? [...fallback] : { ...fallback };
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return Array.isArray(fallback) ? [...fallback] : { ...fallback };
  }
}

export function readUsuarios() {
  return readJsonFile('usuarios.json', []);
}

export function readAgendamentos() {
  return readJsonFile('agendamentos.json', []);
}

export function readDocas() {
  return readJsonFile('docas.json', []);
}

export function readJanelas() {
  return readJsonFile('janelas.json', []);
}

export function readDocumentos() {
  return readJsonFile('documentos.json', []);
}

export function buildDocaPainelFromFiles(dataAgendada = null) {
  const docas = readDocas();
  const agendamentos = readAgendamentos().filter((item) => !dataAgendada || String(item.dataAgendada) === String(dataAgendada));

  const priority = {
    CHEGOU: 1,
    APROVADO: 2,
    PENDENTE_APROVACAO: 3,
    EM_DESCARGA: 4,
    FINALIZADO: 5,
    CANCELADO: 6,
    REPROVADO: 7,
    NO_SHOW: 8,
  };

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
