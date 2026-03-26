import { prisma } from '../../config/prisma.js';

export async function publicCreateAgendamento(req, res) {
  req.body.origemSolicitacao = req.body.origemSolicitacao || 'TRANSPORTADORA';
  const protocol = `PUB-${Date.now()}`;
  const agendamento = await prisma.agendamento.create({
    data: {
      protocolo: protocol,
      unidadeId: Number(req.body.unidadeId),
      fornecedorId: req.body.fornecedorId ? Number(req.body.fornecedorId) : null,
      transportadoraId: req.body.transportadoraId ? Number(req.body.transportadoraId) : null,
      motoristaId: req.body.motoristaId ? Number(req.body.motoristaId) : null,
      veiculoId: req.body.veiculoId ? Number(req.body.veiculoId) : null,
      dataAgendada: new Date(req.body.dataAgendada),
      horaAgendada: req.body.horaAgendada,
      quantidadeNotas: Number(req.body.quantidadeNotas || 0),
      quantidadeVolumes: Number(req.body.quantidadeVolumes || 0),
      pesoTotalKg: req.body.pesoTotalKg ? Number(req.body.pesoTotalKg) : null,
      observacoes: req.body.observacoes || null,
      origemSolicitacao: req.body.origemSolicitacao,
      status: 'PENDENTE_APROVACAO',
    },
  });
  res.status(201).json(agendamento);
}

export async function publicConsultarVoucher(req, res) {
  const protocolo = req.params.protocolo;
  const agendamento = await prisma.agendamento.findUnique({
    where: { protocolo },
    include: { fornecedor: true, transportadora: true, motorista: true, veiculo: true },
  });
  if (!agendamento) return res.status(404).json({ message: 'Protocolo não encontrado' });
  res.json(agendamento);
}

export async function publicConfirmarMotorista(req, res) {
  const protocolo = req.params.protocolo;
  const agendamento = await prisma.agendamento.update({
    where: { protocolo },
    data: {
      status: 'CHEGOU',
      chegadaRealEm: new Date(),
    },
  });
  res.json(agendamento);
}
