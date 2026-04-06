import express from 'express';
import { prisma } from '../utils/prisma.js';
import { generateProtocol, generatePublicToken, verifyInternalSession } from '../utils/security.js';
import { validateAgendamentoPayload, validateNf, normalizeChaveAcesso } from '../utils/validators.js';
import { assertJanelaDocaDisponivel, trafficColor } from '../utils/operations.js';
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from '../utils/db-fallback.js';
import { generateVoucherPdf } from '../utils/voucher-pdf.js';
import { auditLog } from '../utils/audit.js';
import { calculateTotals, normalizeCpf } from '../utils/agendamento-helpers.js';
import { sendMail } from '../utils/email.js';
import { ensureFeedbackRequest, getFeedbackRequestByToken, maskCpf, submitFeedbackByToken } from '../utils/driver-feedback.js';
import { listFornecedoresPendentesImportados } from '../utils/relatorio-entradas.js';
import {
  readJanelas,
  readDocas,
  readAgendamentos,
  createAgendamentoFile,
  findAgendamentoByTokenFile,
  updateAgendamentoFile
} from '../utils/file-store.js';

const router = express.Router();
const ACTIVE_STATUSES = ['PENDENTE_APROVACAO', 'APROVADO', 'CHEGOU', 'EM_DESCARGA'];

function validateNfBatch(notas = []) {
  for (const nota of notas) validateNf(nota || {});
}

function parseJanelaCodigo(codigo = '') {
  const match = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  if (!match) {
    return { horaInicio: String(codigo).trim() || '00:00', horaFim: '', codigo: String(codigo) };
  }
  return { horaInicio: match[1], horaFim: match[2] || '', codigo: String(codigo) };
}

function formatDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function formatDateBR(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) return value || '-';
  return `${day}/${month}/${year}`;
}

function getBaseUrl(req) {
  return process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
}

function getOptionalInternalUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return verifyInternalSession(token);
  } catch {
    return null;
  }
}

function registerQrAudit(req, item, acao, detalhes = {}) {
  const actor = getOptionalInternalUser(req);
  return auditLog({
    usuarioId: actor?.sub || null,
    perfil: actor?.perfil || null,
    acao,
    entidade: 'AGENDAMENTO',
    entidadeId: item?.id || null,
    detalhes,
    ip: req.ip
  });
}

function buildLinks(req, item) {
  const base = getBaseUrl(req);
  return {
    consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`,
    motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`,
    voucher: `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`,
    checkin: `${base}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`,
    checkout: `${base}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkoutToken || '')}`
  };
}

function buildFeedbackLink(req, token) {
  return `${getBaseUrl(req)}/?view=avaliacao&token=${encodeURIComponent(token)}`;
}

function formatItem(item, req) {
  const links = buildLinks(req, item);
  return {
    ...item,
    semaforo: trafficColor(item.status),
    links,
    doca: item.doca?.codigo || item.doca || 'A DEFINIR',
    janela: item.janela?.codigo || item.janela || '-'
  };
}

function canDriverCancel(item) {
  if (['FINALIZADO', 'CANCELADO', 'REPROVADO', 'NO_SHOW', 'EM_DESCARGA'].includes(item.status)) {
    return { allowed: false, reason: 'Status não permite cancelamento.' };
  }
  const schedule = new Date(`${item.dataAgendada}T${item.horaAgendada}:00`);
  const diffHours = (schedule.getTime() - Date.now()) / 36e5;
  return !Number.isFinite(diffHours) || diffHours < 24
    ? { allowed: false, reason: 'Cancelamento permitido apenas com 24h de antecedência.' }
    : { allowed: true, reason: 'Cancelamento disponível.' };
}

async function getOrCreateDocaPadrao() {
  try {
    const existing = await prisma.doca.findFirst({ where: { codigo: 'A DEFINIR' }, orderBy: { id: 'asc' } });
    if (existing) return existing;
    const first = await prisma.doca.findFirst({ orderBy: { id: 'asc' } });
    if (first) return first;
    return prisma.doca.create({ data: { codigo: 'A DEFINIR', descricao: 'Doca definida pelo operador do recebimento' } });
  } catch {
    const docas = readDocas();
    return docas.find((item) => item.codigo === 'A DEFINIR') || docas[0] || { id: 1, codigo: 'A DEFINIR', descricao: 'Doca definida pelo operador do recebimento' };
  }
}

async function resolveByToken(token) {
  try {
    return await prisma.agendamento.findFirst({
      where: {
        OR: [
          { publicTokenFornecedor: token },
          { publicTokenMotorista: token },
          { checkinToken: token },
          { checkoutToken: token }
        ]
      },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
  } catch {
    return findAgendamentoByTokenFile(token);
  }
}

async function dispatchDriverFeedbackEmail(req, agendamento) {
  try {
    if (!String(agendamento?.emailMotorista || '').trim()) {
      await auditLog({
        usuarioId: null,
        perfil: null,
        acao: 'AVALIACAO_POS_CHECKOUT_PENDENTE',
        entidade: 'AGENDAMENTO',
        entidadeId: agendamento?.id || null,
        detalhes: { motivo: 'Sem e-mail do motorista cadastrado.' },
        ip: req.ip
      });
      return { sent: false, reason: 'Sem e-mail do motorista cadastrado.' };
    }

    const feedback = await ensureFeedbackRequest(agendamento);
    const formLink = buildFeedbackLink(req, feedback.token);
    const sent = await sendMail({
      to: agendamento.emailMotorista,
      subject: `Avaliação de atendimento - protocolo ${agendamento.protocolo}`,
      text: [
        `Olá, ${agendamento.motorista || 'motorista'}.`,
        '',
        `Seu recebimento referente ao protocolo ${agendamento.protocolo} foi finalizado.`,
        'Queremos saber como foi o atendimento.',
        '',
        'Este formulário é sigiloso e não fica visível para a equipe operacional de agendamento e descarga.',
        `Link do formulário: ${formLink}`,
        '',
        `Identificação: ${agendamento.motorista || '-'} | Placa: ${agendamento.placa || '-'} | Data: ${formatDateBR(agendamento.dataAgendada)} ${agendamento.horaAgendada || ''}`
      ].join('\n'),
      html: `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;line-height:1.5">
          <p>Olá, <strong>${agendamento.motorista || 'motorista'}</strong>.</p>
          <p>Seu recebimento referente ao protocolo <strong>${agendamento.protocolo}</strong> foi finalizado.</p>
          <p>Gostaríamos de receber sua avaliação sobre o atendimento, a equipe de recebimento e a agilidade do processo.</p>
          <p><strong>Este formulário é sigiloso</strong> e não fica visível para a equipe operacional de agendamento e descarga.</p>
          <p>
            <a href="${formLink}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:700">
              Responder avaliação
            </a>
          </p>
          <p style="font-size:13px;color:#475569">
            Identificação: ${agendamento.motorista || '-'} | Placa: ${agendamento.placa || '-'} | Data: ${formatDateBR(agendamento.dataAgendada)} ${agendamento.horaAgendada || ''}
          </p>
        </div>
      `
    });

    await auditLog({
      usuarioId: null,
      perfil: null,
      acao: sent.sent ? 'AVALIACAO_POS_CHECKOUT_ENVIADA' : 'AVALIACAO_POS_CHECKOUT_PENDENTE',
      entidade: 'AGENDAMENTO',
      entidadeId: agendamento?.id || null,
      detalhes: { to: agendamento.emailMotorista, sent: Boolean(sent.sent), reason: sent.reason || null },
      ip: req.ip
    });

    return sent;
  } catch (error) {
    await auditLog({
      usuarioId: null,
      perfil: null,
      acao: 'AVALIACAO_POS_CHECKOUT_PENDENTE',
      entidade: 'AGENDAMENTO',
      entidadeId: agendamento?.id || null,
      detalhes: { motivo: error.message || 'Falha inesperada ao enviar avaliação.' },
      ip: req.ip
    });
    return { sent: false, reason: error.message || 'Falha inesperada ao enviar avaliação.' };
  }
}

async function createPublicAgendamentoInDatabase({ agendamentoPayload, notas, cpfMotorista }) {
  const protocolo = generateProtocol();
  const publicTokenMotorista = generatePublicToken('MOT', cpfMotorista);
  const publicTokenFornecedor = generatePublicToken('FOR', agendamentoPayload.fornecedor);
  const checkinToken = generatePublicToken('CHK', cpfMotorista || agendamentoPayload.placa);
  const checkoutToken = generatePublicToken('OUT', cpfMotorista || agendamentoPayload.placa);

  const createdId = await prisma.$transaction(async (tx) => {
    const created = await tx.agendamento.create({
      data: {
        protocolo,
        publicTokenMotorista,
        publicTokenFornecedor,
        checkinToken,
        checkoutToken,
        fornecedor: agendamentoPayload.fornecedor,
        transportadora: agendamentoPayload.transportadora,
        motorista: agendamentoPayload.motorista,
        cpfMotorista: agendamentoPayload.cpfMotorista || '',
        telefoneMotorista: agendamentoPayload.telefoneMotorista || '',
        emailMotorista: agendamentoPayload.emailMotorista || '',
        emailTransportadora: agendamentoPayload.emailTransportadora || '',
        placa: agendamentoPayload.placa,
        dataAgendada: agendamentoPayload.dataAgendada,
        horaAgendada: agendamentoPayload.horaAgendada,
        janelaId: Number(agendamentoPayload.janelaId),
        docaId: Number(agendamentoPayload.docaId),
        observacoes: agendamentoPayload.observacoes || '',
        quantidadeNotas: Number(agendamentoPayload.quantidadeNotas || 0),
        quantidadeVolumes: Number(agendamentoPayload.quantidadeVolumes || 0),
        pesoTotalKg: Number(agendamentoPayload.pesoTotalKg || 0),
        valorTotalNf: Number(agendamentoPayload.valorTotalNf || 0),
        status: 'PENDENTE_APROVACAO',
        lgpdConsentAt: new Date()
      }
    });

    if (notas.length) {
      await tx.notaFiscal.createMany({
        data: notas.map((nota) => ({
          agendamentoId: created.id,
          numeroNf: String(nota?.numeroNf || '').trim(),
          serie: String(nota?.serie || '').trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ''),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || '').trim()
        }))
      });
    }

    return created.id;
  });

  return prisma.agendamento.findUnique({ where: { id: createdId }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
}

router.get('/disponibilidade', async (req, res) => {
  const dias = Math.max(1, Math.min(31, Number(req.query?.dias || 14)));
  try {
    const { janelas, docas } = await fetchJanelasDocas();
    const hoje = new Date();
    const datas = Array.from({ length: dias }, (_, index) => {
      const next = new Date(hoje);
      next.setDate(hoje.getDate() + index);
      return formatDate(next);
    });

    const agenda = await Promise.all(datas.map(async (data) => {
      const ocupados = await fetchAgendamentosByDatasStatuses([data], ACTIVE_STATUSES);
      const horarios = janelas.map((janela) => {
        const parsed = parseJanelaCodigo(janela.codigo);
        const ocupadosJanela = ocupados.filter((ag) => {
          return String(ag.janelaId || ag.janela?.id || ag.janela || '') === String(janela.id) || String(ag.horaAgendada || '') === parsed.horaInicio;
        }).length;
        const capacidade = Math.max(docas.length, 1);
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || '',
          ocupados: ocupadosJanela,
          disponivel: Math.max(capacidade - ocupadosJanela, 0),
          ativo: Math.max(capacidade - ocupadosJanela, 0) > 0
        };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    }));

    return res.json({ agenda, meta: { dias, origem: 'database' } });
  } catch {
    const janelas = readJanelas();
    const docas = readDocas();
    const all = readAgendamentos();
    const hoje = new Date();

    const agenda = Array.from({ length: dias }, (_, index) => {
      const next = new Date(hoje);
      next.setDate(hoje.getDate() + index);
      const data = formatDate(next);
      const horarios = janelas.map((janela) => {
        const parsed = parseJanelaCodigo(janela.codigo);
        const ocupados = all.filter((ag) => {
          return String(ag.dataAgendada) === data
            && ACTIVE_STATUSES.includes(ag.status)
            && (String(ag.janelaId || '') === String(janela.id) || String(ag.horaAgendada || '') === parsed.horaInicio);
        }).length;
        const capacidade = Math.max(docas.length, 1);
        return {
          janelaId: janela.id,
          hora: parsed.horaInicio,
          horaFim: parsed.horaFim,
          descricao: janela.descricao || janela.codigo || '',
          ocupados,
          disponivel: Math.max(capacidade - ocupados, 0),
          ativo: Math.max(capacidade - ocupados, 0) > 0
        };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    });

    return res.json({ agenda, meta: { dias, origem: 'arquivo' } });
  }
});

router.get('/fornecedores-pendentes', async (_req, res) => {
  res.json(await listFornecedoresPendentesImportados());
});

router.post('/solicitacao', async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const janelaId = Number(payload.janelaId);
    if (!janelaId) return res.status(400).json({ message: 'Janela é obrigatória.' });

    const cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    const notas = Array.isArray(payload.notas)
      ? payload.notas.map((nota) => ({
          numeroNf: String(nota?.numeroNf || '').trim(),
          serie: String(nota?.serie || '').trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ''),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || '').trim()
        }))
      : [];

    validateNfBatch(notas);
    const totals = calculateTotals(notas, payload);
    const doca = await getOrCreateDocaPadrao();

    let janela;
    try {
      janela = await prisma.janela.findUnique({ where: { id: janelaId } });
    } catch {}
    janela ||= readJanelas().find((item) => Number(item.id) === janelaId);
    if (!janela) return res.status(404).json({ message: 'Janela não encontrada.' });

    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const agendamentoPayload = {
      fornecedor: String(payload.fornecedor || '').trim(),
      transportadora: String(payload.transportadora || '').trim(),
      motorista: String(payload.motorista || '').trim(),
      cpfMotorista,
      telefoneMotorista: String(payload.telefoneMotorista || '').trim(),
      emailMotorista: String(payload.emailMotorista || '').trim(),
      emailTransportadora: String(payload.emailTransportadora || '').trim(),
      placa: String(payload.placa || '').trim().toUpperCase(),
      dataAgendada: String(payload.dataAgendada || '').trim(),
      horaAgendada,
      janelaId,
      docaId: doca.id,
      observacoes: String(payload.observacoes || '').trim(),
      lgpdConsent: Boolean(payload.lgpdConsent),
      ...totals
    };

    validateAgendamentoPayload(agendamentoPayload, true);

    try {
      await assertJanelaDocaDisponivel({ docaId: doca.id, janelaId, dataAgendada: agendamentoPayload.dataAgendada });
      const full = await createPublicAgendamentoInDatabase({ agendamentoPayload, notas, cpfMotorista });
      const links = buildLinks(req, full);
      return res.status(201).json({
        ok: true,
        id: full.id,
        protocolo: full.protocolo,
        horaAgendada,
        doca: full.doca?.codigo || 'A DEFINIR',
        linkMotorista: links.motorista,
        linkFornecedor: links.consulta,
        voucher: links.voucher,
        tokenMotorista: full.publicTokenMotorista,
        tokenConsulta: full.publicTokenFornecedor,
        tokenCheckout: full.checkoutToken
      });
    } catch {
      const record = createAgendamentoFile({
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken('MOT', cpfMotorista),
        publicTokenFornecedor: generatePublicToken('FOR', agendamentoPayload.fornecedor),
        checkinToken: generatePublicToken('CHK', cpfMotorista || agendamentoPayload.placa),
        checkoutToken: generatePublicToken('OUT', cpfMotorista || agendamentoPayload.placa),
        ...agendamentoPayload,
        status: 'PENDENTE_APROVACAO',
        lgpdConsentAt: new Date().toISOString(),
        notasFiscais: notas,
        doca: doca.codigo || 'A DEFINIR',
        janela: janela.codigo
      });
      const links = buildLinks(req, record);
      return res.status(201).json({
        ok: true,
        id: record.id,
        protocolo: record.protocolo,
        horaAgendada,
        doca: record.doca || 'A DEFINIR',
        linkMotorista: links.motorista,
        linkFornecedor: links.consulta,
        voucher: links.voucher,
        tokenMotorista: record.publicTokenMotorista,
        tokenConsulta: record.publicTokenFornecedor,
        tokenCheckout: record.checkoutToken,
        origem: 'arquivo'
      });
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get('/motorista/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token inválido.' });
  res.json({ ...formatItem(item, req), cancelamento: canDriverCancel(item) });
});

router.post('/motorista/:token/cancelar', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token inválido.' });

  const rule = canDriverCancel(item);
  if (!rule.allowed) return res.status(400).json({ message: rule.reason });

  try {
    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: { status: 'CANCELADO', motivoCancelamento: String(req.body?.motivo || 'Cancelado pelo motorista').trim() }
    });
    return res.json({ ok: true, message: 'Agendamento cancelado com sucesso.', agendamento: updated });
  } catch {
    const updated = updateAgendamentoFile(item.id, {
      status: 'CANCELADO',
      motivoCancelamento: String(req.body?.motivo || 'Cancelado pelo motorista').trim()
    });
    return res.json({ ok: true, message: 'Agendamento cancelado com sucesso.', agendamento: updated });
  }
});

router.get('/consulta/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token inválido.' });
  res.json(formatItem(item, req));
});

router.get('/fornecedor/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token inválido.' });
  res.json(formatItem(item, req));
});

router.get('/voucher/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token inválido.' });
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=voucher-${item.protocolo}.pdf`);
  res.send(pdf);
});

router.get('/avaliacao/:token', async (req, res) => {
  const record = await getFeedbackRequestByToken(req.params.token);
  if (!record || !record.token) return res.status(404).json({ message: 'Formulário de avaliação não encontrado.' });

  res.json({
    ok: true,
    responded: Boolean(record.respondeu),
    motorista: {
      nome: record.motorista || '-',
      cpf: maskCpf(record.cpfMotorista),
      placa: record.placa || '-',
      transportadora: record.transportadora || '-',
      fornecedor: record.fornecedor || '-',
      protocolo: record.protocolo || '-',
      dataAgendada: record.dataAgendada || '',
      horaAgendada: record.horaAgendada || ''
    },
    resposta: record.respondeu
      ? {
          atendimentoNota: record.atendimentoNota,
          equipeNota: record.equipeNota,
          rapidezNota: record.rapidezNota,
          processoTranquilo: record.processoTranquilo,
          comentario: record.comentario || '',
          respondeuEm: record.respondeuEm || null
        }
      : null
  });
});

router.post('/avaliacao/:token', async (req, res) => {
  const result = await submitFeedbackByToken(req.params.token, req.body || {});
  if (!result.ok && result.reason === 'not_found') {
    return res.status(404).json({ message: 'Formulário de avaliação não encontrado.' });
  }
  if (!result.ok && result.reason === 'already_submitted') {
    return res.status(409).json({ message: 'Esta avaliação já foi respondida.' });
  }
  if (!result.ok) {
    return res.status(400).json({ message: 'Não foi possível registrar a avaliação.' });
  }

  await auditLog({
    usuarioId: null,
    perfil: null,
    acao: 'AVALIACAO_MOTORISTA_RESPONDIDA',
    entidade: 'AGENDAMENTO',
    entidadeId: result.record?.agendamentoId || null,
    detalhes: {
      atendimentoNota: result.record?.atendimentoNota || null,
      equipeNota: result.record?.equipeNota || null,
      rapidezNota: result.record?.rapidezNota || null,
      processoTranquilo: result.record?.processoTranquilo || null
    },
    ip: req.ip
  });

  res.json({ ok: true, message: 'Avaliação registrada com sucesso. Obrigado pelo retorno.' });
});

router.post('/checkin/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token de check-in inválido.' });
  if (!['APROVADO', 'CHEGOU'].includes(item.status)) return res.status(400).json({ message: 'Check-in só permitido para agendamentos aprovados.' });

  const hoje = formatDate(new Date());
  const liberacaoManual = String(item.dataAgendada || '') !== hoje;
  if (liberacaoManual && !req.body?.overrideDateMismatch) {
    return res.status(409).json({
      message: `Data agendada divergente do dia atual. Agendamento: ${item.dataAgendada}. Hoje: ${hoje}. Avalie a situação e confirme manualmente para liberar a descarga.`
    });
  }

  try {
    const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: 'CHEGOU', checkinEm: item.checkinEm || new Date() } });
    await registerQrAudit(req, updated, 'CHECKIN_QR', { liberacaoManual, dataAgendada: item.dataAgendada, dataValidacao: hoje });
    return res.json({ ok: true, message: liberacaoManual ? 'Check-in realizado com liberação manual do operador.' : 'Check-in realizado com sucesso.', agendamento: updated });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: 'CHEGOU', checkinEm: item.checkinEm || new Date().toISOString() });
    await registerQrAudit(req, updated, 'CHECKIN_QR', { liberacaoManual, dataAgendada: item.dataAgendada, dataValidacao: hoje, origem: 'arquivo' });
    return res.json({ ok: true, message: liberacaoManual ? 'Check-in realizado com liberação manual do operador.' : 'Check-in realizado com sucesso.', agendamento: updated });
  }
});

router.post('/checkout/:token', async (req, res) => {
  const item = await resolveByToken(req.params.token);
  if (!item) return res.status(404).json({ message: 'Token de check-out inválido.' });
  if (!['CHEGOU', 'EM_DESCARGA'].includes(item.status)) return res.status(400).json({ message: 'Check-out só permitido após a chegada.' });

  try {
    const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: 'FINALIZADO', fimDescargaEm: new Date() } });
    await registerQrAudit(req, updated, 'CHECKOUT_QR', { statusAnterior: item.status });
    const feedback = await dispatchDriverFeedbackEmail(req, { ...item, ...updated });
    const message = feedback?.sent
      ? 'Check-out realizado com sucesso. Formulário enviado ao motorista e doca liberada.'
      : `Check-out realizado com sucesso. Doca liberada. Formulário não enviado: ${feedback?.reason || 'falha no envio'}.`;
    return res.json({ ok: true, message, agendamento: updated, feedback });
  } catch {
    const updated = updateAgendamentoFile(item.id, { status: 'FINALIZADO', fimDescargaEm: new Date().toISOString() });
    await registerQrAudit(req, updated, 'CHECKOUT_QR', { statusAnterior: item.status, origem: 'arquivo' });
    const feedback = await dispatchDriverFeedbackEmail(req, { ...item, ...updated });
    const message = feedback?.sent
      ? 'Check-out realizado com sucesso. Formulário enviado ao motorista e doca liberada.'
      : `Check-out realizado com sucesso. Doca liberada. Formulário não enviado: ${feedback?.reason || 'falha no envio'}.`;
    return res.json({ ok: true, message, agendamento: updated, feedback });
  }
});

export default router;
