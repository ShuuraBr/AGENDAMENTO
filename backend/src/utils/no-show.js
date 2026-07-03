import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from './prisma.js';
import { readAgendamentos, updateAgendamentoFile } from './file-store.js';
import { unlinkRelatorioRowsFromAgendamento } from './relatorio-entradas.js';
import { auditLog } from './audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE = path.resolve(__dirname, '../../data/no-show-sweep-state.json');
const BRT_TIMEZONE = 'America/Sao_Paulo';

const ELIGIBLE_STATUSES = new Set(['PENDENTE_APROVACAO', 'APROVADO']);

function normalizeDateValue(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = String(value.getUTCFullYear());
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const y = String(native.getUTCFullYear());
    const m = String(native.getUTCMonth() + 1).padStart(2, '0');
    const d = String(native.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return '';
}

function todayDateOnlyIso(now = new Date()) {
  const y = String(now.getUTCFullYear());
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Elegível assim que o dia agendado termina, sem exigir a hora exata — dá
// margem para atrasos do motorista dentro do próprio dia.
function shouldMarkNoShow(item = {}, now = new Date()) {
  const status = String(item?.status || '').trim().toUpperCase();
  if (!ELIGIBLE_STATUSES.has(status)) return false;
  if (item?.checkinEm || item?.inicioDescargaEm || item?.fimDescargaEm || item?.chegadaRealEm) return false;
  const scheduledDate = normalizeDateValue(item?.dataAgendada || item?.data_agendada);
  if (!scheduledDate) return false;
  return scheduledDate < todayDateOnlyIso(now);
}

async function markAgendamentoAsNoShow(item) {
  try {
    await prisma.agendamento.update({ where: { id: Number(item.id) }, data: { status: 'NO_SHOW' } });
  } catch {
    updateAgendamentoFile(item.id, { status: 'NO_SHOW' });
  }
  await unlinkRelatorioRowsFromAgendamento(item.id, { noShow: true });
  await auditLog({
    usuarioId: null,
    usuarioNome: 'Sistema (varredura automática)',
    perfil: 'SISTEMA',
    acao: 'NO_SHOW_AUTOMATICO',
    entidade: 'AGENDAMENTO',
    entidadeId: item.id,
    detalhes: { motivo: 'Dia agendado encerrado sem check-in.' }
  });
}

async function applyNoShowToDatabase(now = new Date()) {
  const items = await prisma.agendamento.findMany();
  const due = items.filter((item) => shouldMarkNoShow(item, now));
  for (const item of due) {
    await markAgendamentoAsNoShow(item);
  }
  return due.length;
}

function applyNoShowToFile(now = new Date()) {
  const items = readAgendamentos();
  const due = items.filter((item) => shouldMarkNoShow(item, now));
  for (const item of due) {
    updateAgendamentoFile(item.id, { status: 'NO_SHOW' });
  }
  return due.length;
}

export async function runNoShowSweep(now = new Date()) {
  try {
    return await applyNoShowToDatabase(now);
  } catch {
    return applyNoShowToFile(now);
  }
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8').replace(/^﻿/, '')) || {};
  } catch {
    return {};
  }
}

function writeState(state = {}) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[NO_SHOW] Erro ao salvar estado da varredura:', err?.message || err);
  }
}

function agoraBRT(referencia = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: BRT_TIMEZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(referencia).map((p) => [p.type, p.value])
  );
  return {
    hora: parseInt(parts.hour, 10),
    minuto: parseInt(parts.minute, 10),
    dataIso: `${parts.year}-${parts.month}-${parts.day}`
  };
}

/**
 * Varredura diária: assim que vira o dia (a partir de 00:00 BRT), marca como
 * NO_SHOW os agendamentos cujo dia agendado já terminou sem nenhuma ação
 * posterior (sem aprovação seguida de check-in, sem cancelamento, etc.).
 * - Verifica a cada 60s, mas só executa a varredura uma vez por dia.
 * - Persiste a data da última execução para sobreviver a reinícios do servidor.
 * - Se o servidor subir mais tarde no dia sem ter rodado ainda hoje, executa
 *   imediatamente (catch-up).
 */
export function startNoShowWatcher() {
  let executando = false;

  const executar = (dataIso) => {
    if (executando) return;
    executando = true;
    writeState({ ultimaVarredura: dataIso });
    runNoShowSweep(new Date())
      .then((count) => {
        if (count > 0) console.log(`[NO_SHOW] ${count} agendamento(s) marcado(s) automaticamente na varredura diária.`);
      })
      .catch((error) => {
        console.error('[NO_SHOW] Falha na varredura automática:', error?.message || error);
      })
      .finally(() => {
        executando = false;
      });
  };

  const tick = () => {
    const { dataIso } = agoraBRT();
    const ultimaVarredura = readState().ultimaVarredura || '';
    if (ultimaVarredura !== dataIso) executar(dataIso);
  };

  tick();
  const handle = setInterval(tick, 60 * 1000);
  handle.unref?.();
  return handle;
}
