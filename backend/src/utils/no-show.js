import { prisma } from "./prisma.js";
import { readAgendamentos, updateAgendamentoFile } from "./file-store.js";
import { logTechnicalEvent } from "./telemetry.js";

const ELIGIBLE_NO_SHOW_STATUSES = new Set(["PENDENTE_APROVACAO", "APROVADO"]);
const DEFAULT_TIMEZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

function normalizeScheduleDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getUTCFullYear());
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value || "").trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const year = String(native.getUTCFullYear());
    const month = String(native.getUTCMonth() + 1).padStart(2, "0");
    const day = String(native.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return "";
}

function normalizeScheduleTime(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (match) return `${match[1]}:${match[2]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    return `${String(native.getUTCHours()).padStart(2, "0")}:${String(native.getUTCMinutes()).padStart(2, "0")}`;
  }
  return "";
}

function deriveHourFromJanela(item = {}) {
  const janelaCodigo = String(item?.janela?.codigo || item?.janela || item?.janelaCodigo || "").trim();
  const match = janelaCodigo.match(/(\d{2}:\d{2})/);
  return match?.[1] || "";
}

function getNowInTimezone(timeZone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    timeZone
  };
}

function resolveSchedule(item = {}) {
  return {
    dataAgendada: normalizeScheduleDate(item?.dataAgendada || item?.data_agendada || item?.dataProgramada || item?.data),
    horaAgendada: normalizeScheduleTime(item?.horaAgendada || item?.hora_agendada || item?.horaProgramada || item?.hora) || deriveHourFromJanela(item)
  };
}

function hasOperationalStart(item = {}) {
  return !!(item?.checkinEm || item?.checkin_em || item?.inicioDescargaEm || item?.inicio_descarga_em || item?.fimDescargaEm || item?.fim_descarga_em || item?.chegadaRealEm || item?.chegada_real_em);
}

function shouldMarkNoShow(item = {}, reference = getNowInTimezone()) {
  const status = String(item?.status || "").trim().toUpperCase();
  if (!ELIGIBLE_NO_SHOW_STATUSES.has(status)) return false;
  if (hasOperationalStart(item)) return false;
  const { dataAgendada, horaAgendada } = resolveSchedule(item);
  if (!dataAgendada) return false;
  if (dataAgendada < reference.date) return true;
  if (dataAgendada > reference.date) return false;
  const scheduledTime = horaAgendada || "00:00";
  return scheduledTime < String(reference.time || "00:00:00").slice(0, 5);
}

async function persistNoShow(item = {}) {
  const id = Number(item?.id || 0);
  if (!id) return false;
  const patch = { status: "NO_SHOW", updatedAt: new Date().toISOString() };
  try {
    await prisma.agendamento.update({ where: { id }, data: { status: "NO_SHOW" } });
  } catch {
    updateAgendamentoFile(id, patch);
    return true;
  }
  updateAgendamentoFile(id, patch);
  return true;
}

export async function runAutomaticNoShowSweep({ reason = "scheduler", timeZone = DEFAULT_TIMEZONE } = {}) {
  const reference = getNowInTimezone(timeZone);
  let source = "database";
  let items = [];
  try {
    items = await prisma.agendamento.findMany({
      where: { status: { in: [...ELIGIBLE_NO_SHOW_STATUSES] } },
      include: { janela: true }
    });
  } catch {
    source = "file";
    items = readAgendamentos().filter((item) => ELIGIBLE_NO_SHOW_STATUSES.has(String(item?.status || "").trim().toUpperCase()));
  }

  const updatedIds = [];
  for (const item of items || []) {
    if (!shouldMarkNoShow(item, reference)) continue;
    const ok = await persistNoShow(item);
    if (ok) updatedIds.push(Number(item?.id || 0));
  }

  if (updatedIds.length) {
    logTechnicalEvent("automatic-no-show-sweep", {
      reason,
      source,
      updated: updatedIds.length,
      ids: updatedIds,
      referenceDate: reference.date,
      referenceTime: reference.time,
      timeZone: reference.timeZone
    });
  }

  return {
    ok: true,
    reason,
    source,
    updated: updatedIds.length,
    ids: updatedIds,
    referenceDate: reference.date,
    referenceTime: reference.time,
    timeZone: reference.timeZone
  };
}
