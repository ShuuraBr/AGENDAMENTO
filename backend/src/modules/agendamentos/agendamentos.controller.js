import path from 'path';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { generateProtocol } from '../../utils/protocol.js';
import { generateVoucherPdf } from '../../services/voucherService.js';
import { sendEmail } from '../../services/emailService.js';
import { sendWhatsApp } from '../../services/whatsAppService.js';

function shouldAutoApprove(payload) {
  return payload.quantidadeVolumes <= 20 && payload.quantidadeNotas <= 5;
}

export async function listAgendamentos(req, res) {
  const items = await prisma.agendamento.findMany({
    include: {
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true,
    },
    orderBy: [{ dataAgendada: 'desc' }, { horaAgendada: 'desc' }],
  });
  res.json(items);
}

export async function createAgendamento(req, res) {
  const payload = req.body;
  const protocol = generateProtocol();
  const autoApproved = shouldAutoApprove(payload);

  const created = await prisma.agendamento.create({
    data: {
      protocolo: protocol,
      unidadeId: Number(payload.unidadeId),
      fornecedorId: payload.fornecedorId ? Number(payload.fornecedorId) : null,
      transportadoraId: payload.transportadoraId ? Number(payload.transportadoraId) : null,
      motoristaId: payload.motoristaId ? Number(payload.motoristaId) : null,
      veiculoId: payload.veiculoId ? Number(payload.veiculoId) : null,
      dataAgendada: new Date(payload.dataAgendada),
      horaAgendada: payload.horaAgendada,
      quantidadeNotas: Number(payload.quantidadeNotas || 0),
      quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
      pesoTotalKg: payload.pesoTotalKg ? Number(payload.pesoTotalKg) : null,
      observacoes: payload.observacoes || null,
      origemSolicitacao: payload.origemSolicitacao || 'TRANSPORTADORA',
      status: autoApproved ? 'APROVADO' : 'PENDENTE_APROVACAO',
      criadoPorUsuarioId: req.user ? Number(req.user.sub) : null,
    },
    include: {
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
    },
  });

  res.status(201).json({ ...created, autoApproved });
}

export async function approveAgendamento(req, res) {
  const id = Number(req.params.id);
  const updated = await prisma.agendamento.update({
    where: { id },
    data: {
      status: 'APROVADO',
      aprovadoPorUsuarioId: Number(req.user.sub),
      aprovadoEm: new Date(),
    },
  });

  res.json(updated);
}

export async function createVoucher(req, res) {
  const id = Number(req.params.id);
  const agendamento = await prisma.agendamento.findUnique({
    where: { id },
    include: { fornecedor: true, transportadora: true, motorista: true, veiculo: true },
  });
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado' });

  const output = path.resolve(process.cwd(), env.uploadDir, `voucher-${agendamento.protocolo}.pdf`);
  await generateVoucherPdf(agendamento, output);
  res.download(output);
}

export async function sendVoucher(req, res) {
  const id = Number(req.params.id);
  const agendamento = await prisma.agendamento.findUnique({
    where: { id },
    include: { fornecedor: true, transportadora: true, motorista: true, veiculo: true },
  });
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado' });

  const output = path.resolve(process.cwd(), env.uploadDir, `voucher-${agendamento.protocolo}.pdf`);
  await generateVoucherPdf(agendamento, output);

  const contacts = [
    agendamento.fornecedor?.email,
    agendamento.transportadora?.email,
    agendamento.motorista?.email,
  ].filter(Boolean);

  const emailResult = contacts.length
    ? await sendEmail({
        to: contacts.join(','),
        subject: `Voucher de agendamento ${agendamento.protocolo}`,
        text: `Seu agendamento ${agendamento.protocolo} foi confirmado.`,
        html: `<p>Seu agendamento <strong>${agendamento.protocolo}</strong> foi confirmado.</p>`,
        attachments: [{ filename: path.basename(output), path: output }],
      })
    : { ok: false, simulated: true, reason: 'Sem e-mails cadastrados' };

  const baseUrl = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.replace(/\/$/, '')
    : `${req.protocol}://${req.get('host')}`;
  const voucherUrl = agendamento.publicTokenFornecedor
    ? `${baseUrl}/api/public/voucher/${encodeURIComponent(agendamento.publicTokenFornecedor)}`
    : '';
  const dataFormatada = agendamento.dataAgendada
    ? new Date(agendamento.dataAgendada).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
    : '-';
  const horaFormatada = agendamento.horaAgendada || '-';

  const whatsappRecipients = [
    { to: agendamento.fornecedor?.whatsapp, name: agendamento.fornecedor?.razaoSocial || agendamento.fornecedor?.nome || 'Fornecedor' },
    { to: agendamento.transportadora?.whatsapp, name: agendamento.transportadora?.razaoSocial || agendamento.transportadora?.nome || 'Transportadora' },
    { to: agendamento.motorista?.whatsapp, name: agendamento.motorista?.nome || 'Motorista' },
  ].filter((r) => r.to);
  const whatsappResults = [];
  for (const { to, name } of whatsappRecipients) {
    whatsappResults.push(await sendWhatsApp({
      to,
      message: `Agendamento confirmado: ${agendamento.protocolo}`,
      name,
      voucherUrl,
      dataAgendada: dataFormatada,
      horaAgendada: horaFormatada,
    }));
  }

  res.json({ emailResult, whatsappResults });
}

export async function operationalDashboard(req, res) {
  const [agendadosHoje, pendentes, aprovados, emDescarga, finalizados] = await Promise.all([
    prisma.agendamento.count({ where: { dataAgendada: new Date(new Date().toDateString()) } }),
    prisma.agendamento.count({ where: { status: 'PENDENTE_APROVACAO' } }),
    prisma.agendamento.count({ where: { status: 'APROVADO' } }),
    prisma.agendamento.count({ where: { status: 'EM_DESCARGA' } }),
    prisma.agendamento.count({ where: { status: 'FINALIZADO' } }),
  ]);

  res.json({ agendadosHoje, pendentes, aprovados, emDescarga, finalizados });
}
