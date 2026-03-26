import { prisma } from '../config/prisma.js';

function startEndOfDay(dateString) {
  const start = new Date(`${dateString}T00:00:00`);
  const end = new Date(`${dateString}T23:59:59.999`);
  return { start, end };
}

export async function evaluateApprovalRules(payload) {
  const reasons = [];
  let autoApprove = true;

  const unidade = await prisma.unidade.findUnique({ where: { id: payload.unidadeId } });
  if (!unidade || !unidade.ativa) {
    autoApprove = false;
    reasons.push('Unidade inválida ou inativa.');
  }

  if (payload.docaId) {
    const doca = await prisma.doca.findUnique({ where: { id: payload.docaId } } });
    if (!doca || !doca.ativa) {
      autoApprove = false;
      reasons.push('Doca inválida ou inativa.');
    }
  } else {
    autoApprove = false;
    reasons.push('Agendamento sem doca definida exige aprovação manual.');
  }

  if (!payload.fornecedorId && !payload.transportadoraId) {
    autoApprove = false;
    reasons.push('É necessário informar fornecedor ou transportadora.');
  }

  const { start, end } = startEndOfDay(payload.dataAgendada);
  const sameSlotCount = await prisma.agendamento.count({
    where: {
      unidadeId: payload.unidadeId,
      docaId: payload.docaId ?? null,
      dataAgendada: { gte: start, lte: end },
      status: { in: ['PENDENTE_APROVACAO', 'APROVADO', 'AGUARDANDO_CHEGADA', 'CHEGOU', 'EM_TRIAGEM', 'LIBERADO_PARA_DOCA', 'EM_DESCARGA'] },
    },
  });

  if (sameSlotCount >= 4) {
    autoApprove = false;
    reasons.push('Limite operacional do slot atingido para a doca/unidade.');
  }

  if ((payload.quantidadeVolumes ?? 0) > 400) {
    autoApprove = false;
    reasons.push('Carga acima do limite de autoaprovação por volume.');
  }

  if ((payload.pesoTotalKg ?? 0) > 15000) {
    autoApprove = false;
    reasons.push('Carga acima do limite de autoaprovação por peso.');
  }

  if (!reasons.length) reasons.push('Carga dentro das regras de autoaprovação do MVP.');

  return { autoApprove, reasons };
}
