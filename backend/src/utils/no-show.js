import { prisma } from './prisma.js';
import { readAgendamentos, updateAgendamentoFile } from './file-store.js';

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

function normalizeTimeValue(value) {
  if (!value) return '00:00';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (match) return `${match[1]}:${match[2]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    return `${String(native.getUTCHours()).padStart(2, '0')}:${String(native.getUTCMinutes()).padStart(2, '0')}`;
  }
  return '00:00';
}

function scheduledAtFromItem(item = {}) {
  const data = normalizeDateValue(item?.dataAgendada || item?.data_agendada);
  if (!data) return null;
  const hora = normalizeTimeValue(item?.horaAgendada || item?.hora_agendada || item?.janela?.horaInicio || item?.horaInicio || '00:00');
  const scheduledAt = new Date(`${data}T${hora}:00`);
  return Number.isNaN(scheduledAt.getTime()) ? null : scheduledAt;
}

function shouldMarkNoShow(item = {}, now = new Date()) {
  const status = String(item?.status || '').trim().toUpperCase();
  if (!ELIGIBLE_STATUSES.has(status)) return false;
  if (item?.checkinEm || item?.inicioDescargaEm || item?.fimDescargaEm || item?.chegadaRealEm) return false;
  const scheduledAt = scheduledAtFromItem(item);
  if (!scheduledAt) return false;
  return scheduledAt.getTime() < now.getTime();
}

async function applyNoShowToDatabase(now = new Date()) {
  const items = await prisma.agendamento.findMany({ include: { janela: true } });
  const due = items.filter((item) => shouldMarkNoShow(item, now));
  for (const item of due) {
    await prisma.agendamento.update({ where: { id: Number(item.id) }, data: { status: 'NO_SHOW' } });
    updateAgendamentoFile(item.id, { status: 'NO_SHOW' });
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

export function startNoShowWatcher({ intervalMs = 5 * 60 * 1000 } = {}) {
  const execute = async () => {
    try {
      const count = await runNoShowSweep(new Date());
      if (count > 0) console.log(`[NO_SHOW] ${count} agendamento(s) atualizado(s) automaticamente.`);
    } catch (error) {
      console.error('[NO_SHOW] Falha na atualização automática:', error?.message || error);
    }
  };

  execute();
  return setInterval(execute, Math.max(60_000, Number(intervalMs) || 300_000));
}
