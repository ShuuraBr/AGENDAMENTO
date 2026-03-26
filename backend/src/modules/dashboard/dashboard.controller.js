import { prisma } from '../../config/prisma.js';

export async function operacional(req, res) {
  const today = new Date();
  const start = new Date(`${today.toISOString().slice(0, 10)}T00:00:00`);
  const end = new Date(`${today.toISOString().slice(0, 10)}T23:59:59.999`);

  const agendamentos = await prisma.agendamento.findMany({
    where: { dataAgendada: { gte: start, lte: end } },
    include: {
      fornecedor: true,
      transportadora: true,
      motorista: true,
      doca: true,
      unidade: true,
      documentos: true,
    },
    orderBy: [{ horaAgendada: 'asc' }],
  });

  const kpis = {
    total: agendamentos.length,
    pendentesAprovacao: agendamentos.filter((x) => x.status === 'PENDENTE_APROVACAO').length,
    aprovados: agendamentos.filter((x) => x.status === 'APROVADO').length,
    emDescarga: agendamentos.filter((x) => x.status === 'EM_DESCARGA').length,
    finalizados: agendamentos.filter((x) => x.status === 'FINALIZADO').length,
    noShow: agendamentos.filter((x) => x.status === 'NO_SHOW').length,
    comDocumentos: agendamentos.filter((x) => (x.documentos?.length || 0) > 0).length,
  };

  res.json({ kpis, agendamentos });
}
