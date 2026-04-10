const DOCA_OCCUPYING_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function occupiesDoca(status) {
  return DOCA_OCCUPYING_STATUSES.includes(String(status || ""));
}

import { prisma } from "./prisma.js";
import { readAgendamentos, readDocas } from "./file-store.js";
import { normalizeAgendamentoNotas } from "./nota-metadata.js";

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
  if (["EM_DESCARGA", "CHEGOU"].includes(status)) return "VERDE";
  if (["APROVADO", "PENDENTE_APROVACAO"].includes(status)) return "AMARELO";
  return "VERMELHO";
}

function enrichFilaItem(item = {}) {
  const notas = normalizeAgendamentoNotas(Array.isArray(item?.notasFiscais) ? item.notasFiscais : []);
  const destinos = [...new Set(notas.map((nota) => String(nota?.destino || nota?.empresa || '').trim()).filter(Boolean))];
  const quantidadeItens = notas.reduce((acc, nota) => acc + Number(nota?.quantidadeItens || 0), 0);
  return {
    ...item,
    notasFiscais: notas,
    destinos,
    quantidadeItens,
    quantidadeNotas: Number(item?.quantidadeNotas || notas.length || 0),
    quantidadeVolumes: Number(item?.quantidadeVolumes || notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0) || 0),
    pesoTotalKg: Number(item?.pesoTotalKg || notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0) || 0)
  };
}

export async function docaPainel(dataAgendada = null) {
  const where = dataAgendada ? { dataAgendada: String(dataAgendada) } : {};
  try {
    const [docas, agendamentos] = await Promise.all([
      prisma.doca.findMany({ orderBy: { codigo: "asc" } }),
      prisma.agendamento.findMany({ where, include: { notasFiscais: true }, orderBy: [{ horaAgendada: "asc" }, { id: "asc" }] })
    ]);

    return docas.map((doca) => {
      const fila = agendamentos
        .filter((a) => a.docaId === doca.id && occupiesDoca(a.status))
        .sort((a, b) => {
          const pa = queuePriority(a.status);
          const pb = queuePriority(b.status);
          if (pa !== pb) return pa - pb;
          return String(a.horaAgendada).localeCompare(String(b.horaAgendada));
        })
        .map(enrichFilaItem);

      const ativo = fila.find((a) => ["CHEGOU", "EM_DESCARGA"].includes(a.status)) || fila[0] || null;

      return {
        docaId: doca.id,
        codigo: doca.codigo,
        descricao: doca.descricao,
        ocupacaoAtual: ativo ? ativo.status : "LIVRE",
        semaforo: ativo ? trafficColor(ativo.status) : "VERDE",
        fila
      };
    });
  } catch {
    const docas = readDocas();
    const agendamentos = readAgendamentos()
      .filter((item) => !dataAgendada || String(item?.dataAgendada || '') === String(dataAgendada))
      .map((item) => enrichFilaItem(item));

    return docas.map((doca) => {
      const fila = agendamentos
        .filter((a) => Number(a?.docaId || a?.doca?.id || 0) === Number(doca.id) && occupiesDoca(a.status))
        .sort((a, b) => {
          const pa = queuePriority(a.status);
          const pb = queuePriority(b.status);
          if (pa !== pb) return pa - pb;
          return String(a.horaAgendada).localeCompare(String(b.horaAgendada));
        });

      const ativo = fila.find((a) => ["CHEGOU", "EM_DESCARGA"].includes(a.status)) || fila[0] || null;

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
}
