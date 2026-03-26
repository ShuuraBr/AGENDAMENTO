import { prisma } from "../../config/prisma.js";

export async function calcularAprovacaoAutomatica(payload) {
  const janela = payload.janelaId
    ? await prisma.janelaAgendamento.findUnique({ where: { id: payload.janelaId } })
    : null;

  if (!janela) return { aprovadoAutomaticamente: false, motivo: "Janela não informada." };
  if (janela.status !== "DISPONIVEL") return { aprovadoAutomaticamente: false, motivo: "Janela indisponível." };
  if (janela.capacidadeOcupada >= janela.capacidadeMaxima) return { aprovadoAutomaticamente: false, motivo: "Janela lotada." };

  const regra = await prisma.regraAgendamento.findFirst({
    where: { unidadeId: payload.unidadeId, ativo: true },
    orderBy: { id: "desc" }
  });

  if (!regra || !regra.permiteAprovacaoAutomatica) {
    return { aprovadoAutomaticamente: false, motivo: "Regra exige aprovação manual." };
  }

  return { aprovadoAutomaticamente: true, motivo: "Aprovação automática permitida." };
}

export async function ocuparJanela(janelaId) {
  if (!janelaId) return;
  await prisma.janelaAgendamento.update({
    where: { id: janelaId },
    data: { capacidadeOcupada: { increment: 1 } }
  });
}

export async function liberarJanela(janelaId) {
  if (!janelaId) return;
  const janela = await prisma.janelaAgendamento.findUnique({ where: { id: janelaId } });
  if (!janela || janela.capacidadeOcupada <= 0) return;
  await prisma.janelaAgendamento.update({
    where: { id: janelaId },
    data: { capacidadeOcupada: { decrement: 1 } }
  });
}
