import { prisma } from "./prisma.js";
import { readAgendamentos } from "./file-store.js";

const OCCUPYING_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function occupiesDoca(status) {
  return OCCUPYING_STATUSES.includes(String(status || ""));
}

function normalizeNotas(item = {}) {
  return Array.isArray(item?.notasFiscais)
    ? item.notasFiscais
    : Array.isArray(item?.notas)
      ? item.notas
      : [];
}

function buildFilaItem(item = {}) {
  const notas = normalizeNotas(item);
  return {
    ...item,
    notas,
    totalNotas: Number(item?.quantidadeNotas || notas.length || 0),
    totalVolumes: Number(item?.quantidadeVolumes || notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0) || 0),
    totalItens: Number(item?.quantidadeItens || notas.reduce((acc, nota) => acc + Number(nota?.quantidadeItens || 0), 0) || 0),
    pesoTotalKg: Number(item?.pesoTotalKg || notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0) || 0),
    notasResumo: notas.map((nota) => ({
      rowHash: nota?.rowHash || null,
      numeroNf: String(nota?.numeroNf || '').trim(),
      serie: String(nota?.serie || '').trim(),
      destino: String(nota?.destino || '').trim(),
      volumes: Number(nota?.volumes || 0),
      quantidadeItens: Number(nota?.quantidadeItens || 0),
      peso: Number(nota?.peso || 0),
      valorNf: Number(nota?.valorNf || 0)
    }))
  };
}

export function queuePriority(status) {
  const map = {
    CHEGOU: 1,
    EM_DESCARGA: 2,
    APROVADO: 3,
    PENDENTE_APROVACAO: 4
  };
  return map[status] || 99;
}

export async function assertJanelaDocaDisponivel({ janelaId, dataAgendada, ignoreAgendamentoId = null }) {
  let conflict = null;

  try {
    conflict = await prisma.agendamento.findFirst({
      where: {
        id: ignoreAgendamentoId ? { not: Number(ignoreAgendamentoId) } : undefined,
        janelaId: Number(janelaId),
        dataAgendada: String(dataAgendada),
        status: { in: OCCUPYING_STATUSES }
      }
    });
  } catch {
    conflict = readAgendamentos().find((item) => {
      if (ignoreAgendamentoId && Number(item?.id) === Number(ignoreAgendamentoId)) return false;
      return Number(item?.janelaId || item?.janela?.id || 0) === Number(janelaId)
        && String(item?.dataAgendada || '') === String(dataAgendada)
        && OCCUPYING_STATUSES.includes(String(item?.status || ''));
    }) || null;
  }

  if (conflict) {
    throw new Error(`Conflito de horário. Já existe o agendamento ${conflict.protocolo} ocupando esta janela neste dia.`);
  }
}

export function trafficColor(status) {
  if (["EM_DESCARGA", "CHEGOU"].includes(status)) return "VERDE";
  if (["APROVADO", "PENDENTE_APROVACAO"].includes(status)) return "AMARELO";
  return "VERMELHO";
}

export async function docaPainel(dataAgendada = null) {
  const where = dataAgendada ? { dataAgendada: String(dataAgendada) } : {};
  const [docas, agendamentos] = await Promise.all([
    prisma.doca.findMany({ orderBy: { codigo: "asc" } }),
    prisma.agendamento.findMany({ where, include: { notasFiscais: true }, orderBy: { horaAgendada: "asc" } })
  ]);

  return docas.map((doca) => {
    const fila = agendamentos
      .filter((a) => a.docaId === doca.id && occupiesDoca(a.status))
      .sort((a, b) => {
        const pa = queuePriority(a.status);
        const pb = queuePriority(b.status);
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada || '').localeCompare(String(b.horaAgendada || ''));
      })
      .map(buildFilaItem);

    const ativo = fila.find((a) => ["CHEGOU", "EM_DESCARGA"].includes(a.status)) || fila[0] || null;

    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao,
      ocupacaoAtual: ativo ? ativo.status : "LIVRE",
      semaforo: ativo ? trafficColor(ativo.status) : "VERDE",
      totalAgendamentos: fila.length,
      totalNotas: fila.reduce((acc, item) => acc + Number(item.totalNotas || 0), 0),
      totalVolumes: fila.reduce((acc, item) => acc + Number(item.totalVolumes || 0), 0),
      totalItens: fila.reduce((acc, item) => acc + Number(item.totalItens || 0), 0),
      pesoTotalKg: Number(fila.reduce((acc, item) => acc + Number(item.pesoTotalKg || 0), 0).toFixed(3)),
      fila
    };
  });
}
