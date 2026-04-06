const DOCA_OCCUPYING_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function occupiesDoca(status) {
  return DOCA_OCCUPYING_STATUSES.includes(String(status || ""));
}

import { prisma } from "./prisma.js";
import { readAgendamentos } from "./file-store.js";

export function queuePriority(status) {
  const map = {
    CHEGOU: 1,
    EM_DESCARGA: 2,
    APROVADO: 3,
    PENDENTE_APROVACAO: 4
  };
  return map[status] || 99;
}

export async function assertJanelaDocaDisponivel({ docaId, janelaId, dataAgendada, ignoreAgendamentoId = null }) {
  let conflict = null;

  try {
    conflict = await prisma.agendamento.findFirst({
      where: {
        id: ignoreAgendamentoId ? { not: Number(ignoreAgendamentoId) } : undefined,
        docaId: Number(docaId),
        janelaId: Number(janelaId),
        dataAgendada: String(dataAgendada),
        status: { in: ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"] }
      }
    });
  } catch {
    conflict = readAgendamentos().find((item) => {
      if (ignoreAgendamentoId && Number(item?.id) === Number(ignoreAgendamentoId)) return false;
      return Number(item?.docaId || item?.doca?.id || 0) === Number(docaId)
        && Number(item?.janelaId || item?.janela?.id || 0) === Number(janelaId)
        && String(item?.dataAgendada || '') === String(dataAgendada)
        && ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"].includes(String(item?.status || ''));
    }) || null;
  }

  if (conflict) {
    throw new Error(`Conflito de doca/janela. Já existe o agendamento ${conflict.protocolo} ocupando esta posição.`);
  }
}

export function trafficColor(status) {
  const normalized = String(status || "").toUpperCase();
  if (["LIVRE", "FINALIZADO"].includes(normalized)) return "VERDE";
  if (["PENDENTE_APROVACAO"].includes(normalized)) return "AMARELO";
  if (["APROVADO", "CHEGOU"].includes(normalized)) return "AZUL";
  if (["EM_DESCARGA"].includes(normalized)) return "LARANJA";
  if (["NO_SHOW"].includes(normalized)) return "CINZA";
  return "VERMELHO";
}

export async function docaPainel(dataAgendada = null) {
  const where = dataAgendada ? { dataAgendada: String(dataAgendada) } : {};
  const [docas, agendamentos] = await Promise.all([
    prisma.doca.findMany({ orderBy: { codigo: "asc" } }),
    prisma.agendamento.findMany({ where, orderBy: { horaAgendada: "asc" } })
  ]);

  return docas.map(doca => {
    const fila = agendamentos
      .filter(a => a.docaId === doca.id && occupiesDoca(a.status))
      .sort((a, b) => {
        const pa = queuePriority(a.status);
        const pb = queuePriority(b.status);
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada).localeCompare(String(b.horaAgendada));
      });

    const ativo = fila.find(a => ["CHEGOU", "EM_DESCARGA"].includes(a.status)) || fila[0] || null;

    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao,
      ocupacaoAtual: ativo ? ativo.status : "LIVRE",
      semaforo: ativo ? trafficColor(ativo.status) : "VERDE",
      fila
    };
  });
}
