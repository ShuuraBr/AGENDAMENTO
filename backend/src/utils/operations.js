import { prisma } from "./prisma.js";

export function queuePriority(status) {
  const map = {
    CHEGOU: 1,
    APROVADO: 2,
    PENDENTE_APROVACAO: 3,
    EM_DESCARGA: 4,
    FINALIZADO: 5,
    CANCELADO: 6,
    REPROVADO: 7,
    NO_SHOW: 8
  };
  return map[status] || 99;
}

export async function assertJanelaDocaDisponivel({ docaId, janelaId, dataAgendada, ignoreAgendamentoId = null }) {
  const conflict = await prisma.agendamento.findFirst({
    where: {
      id: ignoreAgendamentoId ? { not: Number(ignoreAgendamentoId) } : undefined,
      docaId: Number(docaId),
      janelaId: Number(janelaId),
      dataAgendada: String(dataAgendada),
      status: { in: ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"] }
    }
  });
  if (conflict) {
    throw new Error(`Conflito de doca/janela. Já existe o agendamento ${conflict.protocolo} ocupando esta posição.`);
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
    prisma.agendamento.findMany({ where, orderBy: { horaAgendada: "asc" } })
  ]);

  return docas.map(doca => {
    const fila = agendamentos
      .filter(a => a.docaId === doca.id)
      .sort((a, b) => {
        const pa = queuePriority(a.status);
        const pb = queuePriority(b.status);
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada).localeCompare(String(b.horaAgendada));
      });

    const filaVisivel = fila.filter(a => a.status === "CHEGOU" || a.status === "EM_DESCARGA");
    const ativo = filaVisivel.find(a => ["EM_DESCARGA", "CHEGOU"].includes(a.status)) || null;

    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao,
      ocupacaoAtual: ativo ? ativo.status : "LIVRE",
      semaforo: ativo ? trafficColor(ativo.status) : "VERDE",
      fila: filaVisivel
    };
  });
}
