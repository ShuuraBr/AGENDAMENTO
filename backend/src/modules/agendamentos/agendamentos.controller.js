import path from 'path';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { generateProtocol } from '../../utils/protocol.js';
import { evaluateApprovalRules } from '../../utils/rules.js';
import { generateVoucherPdf } from '../../utils/voucher-pdf.js';
import { simulateVoucherDispatch } from '../../utils/notifications.js';
import {
  createAgendamentoSchema,
  listAgendamentosSchema,
  uploadDocumentoSchema,
  approveSchema,
} from './agendamentos.schemas.js';

function timeStringToDate(time) {
  return new Date(`1970-01-01T${time.length === 5 ? `${time}:00` : time}Z`);
}

function normalizeDate(dateString) {
  return new Date(`${dateString}T00:00:00`);
}

async function getAgendamentoFull(id) {
  return prisma.agendamento.findUnique({
    where: { id },
    include: {
      unidade: true,
      doca: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true,
      criadoPor: { select: { id: true, nome: true, email: true } },
      aprovadoPor: { select: { id: true, nome: true, email: true } },
    },
  });
}

export async function list(req, res) {
  const query = listAgendamentosSchema.parse(req.query);
  const where = {};

  if (query.data) where.dataAgendada = normalizeDate(query.data);
  if (query.status) where.status = query.status;

  const data = await prisma.agendamento.findMany({
    where,
    include: {
      unidade: true,
      doca: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true,
    },
    orderBy: [{ dataAgendada: 'desc' }, { horaAgendada: 'desc' }],
  });

  res.json(data);
}

export async function getById(req, res) {
  const id = BigInt(req.params.id);
  const data = await getAgendamentoFull(id);
  if (!data) return res.status(404).json({ message: 'Agendamento não encontrado.' });
  res.json(data);
}

export async function create(req, res) {
  const payload = createAgendamentoSchema.parse(req.body);
  const rules = await evaluateApprovalRules(payload);
  const status = rules.autoApprove ? 'APROVADO' : 'PENDENTE_APROVACAO';

  const agendamento = await prisma.agendamento.create({
    data: {
      protocolo: generateProtocol(),
      unidadeId: payload.unidadeId,
      docaId: payload.docaId ?? null,
      fornecedorId: payload.fornecedorId ?? null,
      transportadoraId: payload.transportadoraId ?? null,
      motoristaId: payload.motoristaId ?? null,
      veiculoId: payload.veiculoId ?? null,
      origemSolicitacao: payload.origemSolicitacao,
      status,
      dataAgendada: normalizeDate(payload.dataAgendada),
      horaAgendada: timeStringToDate(payload.horaAgendada),
      quantidadeNotas: payload.quantidadeNotas,
      quantidadeVolumes: payload.quantidadeVolumes,
      pesoTotalKg: payload.pesoTotalKg ?? null,
      valorTotalNf: payload.valorTotalNf ?? null,
      observacoes: payload.observacoes ?? null,
      criadoPorUsuarioId: req.user?.id ? BigInt(req.user.id) : null,
      aprovadoPorUsuarioId: rules.autoApprove && req.user?.id ? BigInt(req.user.id) : null,
      aprovadoEm: rules.autoApprove ? new Date() : null,
    },
    include: {
      unidade: true,
      doca: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true,
    },
  });

  res.status(201).json({ agendamento, approval: rules });
}

async function setStatus(id, data) {
  return prisma.agendamento.update({
    where: { id },
    data,
    include: {
      unidade: true,
      doca: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true,
    },
  });
}

export async function previewApproval(req, res) {
  const payload = createAgendamentoSchema.parse(req.body);
  const rules = await evaluateApprovalRules(payload);
  res.json(rules);
}

export async function approve(req, res) {
  const id = BigInt(req.params.id);
  const body = approveSchema.parse(req.body ?? {});
  const agendamento = await getAgendamentoFull(id);
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado.' });

  if (!body.force) {
    const preview = await evaluateApprovalRules({
      unidadeId: agendamento.unidadeId,
      docaId: agendamento.docaId,
      fornecedorId: agendamento.fornecedorId,
      transportadoraId: agendamento.transportadoraId,
      motoristaId: agendamento.motoristaId,
      veiculoId: agendamento.veiculoId,
      dataAgendada: agendamento.dataAgendada.toISOString().slice(0, 10),
      horaAgendada: agendamento.horaAgendada.toISOString().slice(11, 19),
      quantidadeNotas: agendamento.quantidadeNotas,
      quantidadeVolumes: agendamento.quantidadeVolumes,
      pesoTotalKg: Number(agendamento.pesoTotalKg ?? 0),
      valorTotalNf: Number(agendamento.valorTotalNf ?? 0),
      observacoes: agendamento.observacoes,
      origemSolicitacao: agendamento.origemSolicitacao,
    });

    if (!preview.autoApprove) {
      return res.status(409).json({
        message: 'Agendamento fora das regras de aprovação automática. Reenvie com force=true para aprovar manualmente.',
        approval: preview,
      });
    }
  }

  const data = await setStatus(id, {
    status: 'APROVADO',
    aprovadoEm: new Date(),
    aprovadoPorUsuarioId: BigInt(req.user.id),
  });

  res.json(data);
}

export async function cancel(req, res) {
  const id = BigInt(req.params.id);
  res.json(await setStatus(id, { status: 'CANCELADO' }));
}

export async function checkin(req, res) {
  const id = BigInt(req.params.id);
  res.json(await setStatus(id, { status: 'CHEGOU', chegadaRealEm: new Date() }));
}

export async function startUnload(req, res) {
  const id = BigInt(req.params.id);
  res.json(await setStatus(id, { status: 'EM_DESCARGA', inicioDescargaEm: new Date() }));
}

export async function finishUnload(req, res) {
  const id = BigInt(req.params.id);
  res.json(await setStatus(id, { status: 'FINALIZADO', fimDescargaEm: new Date() }));
}

export async function uploadDocument(req, res) {
  const id = BigInt(req.params.id);
  const agendamento = await prisma.agendamento.findUnique({ where: { id } });
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado.' });
  if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado.' });

  const body = uploadDocumentoSchema.parse(req.body);
  const publicUrl = `${env.appUrl}/uploads/${path.basename(req.file.filename)}`;

  const documento = await prisma.documento.create({
    data: {
      agendamentoId: id,
      tipoDocumento: body.tipoDocumento,
      nomeArquivo: req.file.originalname,
      urlArquivo: publicUrl,
      mimeType: req.file.mimetype,
      tamanhoBytes: BigInt(req.file.size),
    },
  });

  res.status(201).json(documento);
}

export async function listDocuments(req, res) {
  const id = BigInt(req.params.id);
  const documentos = await prisma.documento.findMany({ where: { agendamentoId: id }, orderBy: { id: 'desc' } });
  res.json(documentos);
}

export async function generateVoucher(req, res) {
  const id = BigInt(req.params.id);
  const agendamento = await getAgendamentoFull(id);
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado.' });

  const buffer = await generateVoucherPdf(agendamento);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=voucher-${agendamento.protocolo}.pdf`);
  res.send(buffer);
}

export async function dispatchVoucher(req, res) {
  const id = BigInt(req.params.id);
  const agendamento = await getAgendamentoFull(id);
  if (!agendamento) return res.status(404).json({ message: 'Agendamento não encontrado.' });

  const dispatch = await simulateVoucherDispatch(agendamento);
  res.json({ success: true, protocolo: agendamento.protocolo, dispatch });
}
