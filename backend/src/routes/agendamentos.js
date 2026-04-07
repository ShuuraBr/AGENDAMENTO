import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";
import { sendMail } from "../utils/email.js";
import { sendWhatsApp } from "../services/whatsapp.js";
import { calculateTotals, normalizeCpf } from "../utils/agendamento-helpers.js";
import { readAgendamentos, findAgendamentoFile, updateAgendamentoFile, createAgendamentoFile, addDocumentoFile, addNotaFile } from "../utils/file-store.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { auditLog } from "../utils/audit.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { fetchAgendamentosRaw } from "../utils/db-fallback.js";
import { canonicalizeNotasSelecionadasComRelatorio, linkRelatorioRowsToAgendamento } from "../utils/relatorio-entradas.js";
import { sendDriverFeedbackRequestEmail } from "../utils/feedback-notifications.js";
import { analyzeNotesForSchedule, enrichAgendamentoWithMonitoring, sendFinanceAwarenessEmail, searchByNumeroNf } from "../utils/nf-monitoring.js";

const router = Router();
router.use(authRequired);

const uploadDir = path.resolve("uploads", "documentos");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
});
const upload = multer({ storage });

function getBaseUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function buildPublicLinks(req, item) {
  const base = getBaseUrl(req);
  return {
    consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`,
    motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`,
    voucher: `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`,
    checkin: `${base}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`,
    checkout: `${base}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkoutToken || "")}`
  };
}

function formatDateBR(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

function buildScheduleIntro(item) {
  return `O agendamento foi efetuado para o dia ${formatDateBR(item.dataAgendada)}, às ${item.horaAgendada || "-"}. Solicitamos chegada com 10 minutos de antecedência.`;
}

async function dispatchDriverFeedbackSurvey(item, req, actor = req.user) {
  const result = await sendDriverFeedbackRequestEmail({
    agendamento: item,
    baseUrl: getBaseUrl(req)
  });

  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    perfil: actor?.perfil || null,
    acao: 'ENVIAR_AVALIACAO',
    entidade: 'AGENDAMENTO',
    entidadeId: item.id,
    detalhes: {
      sent: !!result?.sent,
      to: result?.to || null,
      feedbackLink: result?.feedbackLink || null,
      reason: result?.reason || null
    },
    ip: req.ip
  });

  return result;
}

async function full(id) {
  try {
    return await prisma.agendamento.findUnique({ where: { id: Number(id) }, include: { notasFiscais: true, documentos: true, doca: true, janela: true } });
  } catch {
    return findAgendamentoFile(id);
  }
}

async function mustExist(id) {
  try { return await prisma.agendamento.findUnique({ where: { id: Number(id) } }); } catch { return findAgendamentoFile(id); }
}

async function notificationSummary(agendamentoId) {
  const logs = await prisma.logAuditoria.findMany({
    where: { entidade: "AGENDAMENTO", entidadeId: Number(agendamentoId) },
    orderBy: { createdAt: "desc" }
  });

  const findLog = (acao, predicate = () => true) => logs.find((log) => {
    if (log.acao !== acao) return false;
    try {
      const detalhes = log.detalhes ? JSON.parse(log.detalhes) : {};
      return predicate(detalhes || {});
    } catch {
      return false;
    }
  });

  return {
    voucherMotorista: !!findLog("ENVIAR_INFORMACOES", (d) => Array.isArray(d.targets) && d.targets.includes("motorista")),
    voucherTransportadoraFornecedor: !!findLog("ENVIAR_INFORMACOES", (d) => Array.isArray(d.targets) && d.targets.includes("transportadora/fornecedor")),
    confirmacaoTransportadoraFornecedor: !!findLog("ENVIAR_CONFIRMACAO", (d) => Array.isArray(d.targets) && d.targets.includes("transportadora/fornecedor"))
  };
}

const EMPTY_NOTIFICATIONS = { voucherMotorista: false, voucherTransportadoraFornecedor: false, confirmacaoTransportadoraFornecedor: false };

async function enrichResponseItem(item) {
  if (!item) return item;
  try { return await enrichAgendamentoWithMonitoring(item); } catch { return item; }
}

async function buildAwarenessAnalysisFromPayload(base = {}, payload = {}) {
  const notas = Array.isArray(base?.notasFiscais) ? base.notasFiscais : Array.isArray(payload?.notasFiscais) ? payload.notasFiscais : [];
  const fornecedor = payload?.fornecedor || base?.fornecedor || '';
  const dataAgendada = payload?.dataAgendada || base?.dataAgendada || '';
  return analyzeNotesForSchedule({ notas, fornecedor, dataAgendada });
}

async function sendFinanceAwarenessIfNeeded({ agendamento, payload, actor }) {
  const analysis = await buildAwarenessAnalysisFromPayload(agendamento, payload);
  if (!analysis?.requiresAwareness || !payload?.confirmarCienciaVencimento) return { sent: false, reason: 'Ciência não necessária ou não confirmada.' };
  return sendFinanceAwarenessEmail({ agendamento, analysis, actor });
}

async function safeNotificationSummary(agendamentoId) {
  try {
    return await notificationSummary(agendamentoId);
  } catch {
    return { ...EMPTY_NOTIFICATIONS };
  }
}

async function createAgendamentoInDatabase(payload) {
  const notas = Array.isArray(payload.notasFiscais) ? payload.notasFiscais : [];
  const protocol = generateProtocol();
  const publicTokenMotorista = generatePublicToken("MOT", payload.cpfMotorista);
  const publicTokenFornecedor = generatePublicToken("FOR", payload.fornecedor);
  const checkinToken = generatePublicToken("CHK", payload.cpfMotorista || payload.placa);
  const checkoutToken = generatePublicToken("OUT", payload.cpfMotorista || payload.placa);

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.agendamento.create({
      data: {
        protocolo: protocol,
        publicTokenMotorista,
        publicTokenFornecedor,
        checkinToken,
        checkoutToken,
        fornecedor: payload.fornecedor,
        transportadora: payload.transportadora,
        motorista: payload.motorista,
        cpfMotorista: payload.cpfMotorista || "",
        telefoneMotorista: payload.telefoneMotorista || "",
        emailMotorista: payload.emailMotorista || "",
        emailTransportadora: payload.emailTransportadora || "",
        placa: payload.placa,
        docaId: Number(payload.docaId),
        janelaId: Number(payload.janelaId),
        dataAgendada: payload.dataAgendada,
        horaAgendada: payload.horaAgendada,
        quantidadeNotas: Number(payload.quantidadeNotas || 0),
        quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
        pesoTotalKg: Number(payload.pesoTotalKg || 0),
        valorTotalNf: Number(payload.valorTotalNf || 0),
        status: "PENDENTE_APROVACAO",
        observacoes: payload.observacoes || ""
      }
    });

    if (notas.length) {
      await tx.notaFiscal.createMany({
        data: notas.map((nota) => ({
          agendamentoId: created.id,
          numeroNf: String(nota?.numeroNf || "").trim(),
          serie: String(nota?.serie || "").trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || "").trim()
        }))
      });
    }

    return created.id;
  });

  return full(item);
}

async function sendApprovalNotifications(item, req) {
  const links = buildPublicLinks(req, item);
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  const results = [];
  const targets = [];
  const scheduleIntro = buildScheduleIntro(item);

  const commonText = [
    scheduleIntro,
    `Protocolo: ${item.protocolo}`,
    `Consulta do fornecedor/transportadora: ${links.consulta}`,
    `Acompanhamento do motorista: ${links.motorista}`,
    `Token do motorista: ${item.publicTokenMotorista}`,
    `Voucher PDF: ${links.voucher}`,
    `Check-in: ${links.checkin}`,
    `Check-out: ${links.checkout}`
  ].join("\n");

  const commonHtml = `
    <p>${scheduleIntro}</p>
    <p><strong>Protocolo:</strong> ${item.protocolo}</p>
    <p><strong>Data:</strong> ${formatDateBR(item.dataAgendada)}</p>
    <p><strong>Hora:</strong> ${item.horaAgendada || "-"}</p>
    <p><a href="${links.consulta}">Consulta da transportadora/fornecedor</a></p>
    <p><a href="${links.motorista}">Acompanhamento do motorista</a></p>
    <p><strong>Token do motorista:</strong> ${item.publicTokenMotorista}</p>
    <p><a href="${links.voucher}">Voucher em PDF</a></p>
    <p><a href="${links.checkin}">Check-in</a></p>
    <p><a href="${links.checkout}">Check-out</a></p>
  `;

  if (item.emailMotorista) {
    const sent = await sendMail({
      to: item.emailMotorista,
      subject: `Voucher do agendamento ${item.protocolo}`,
      text: commonText,
      html: `<p>Olá, motorista.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ tipo: "motorista", to: item.emailMotorista, ...sent });
    if (sent.sent) targets.push("motorista");
  }

  if (item.emailTransportadora) {
    const sent = await sendMail({
      to: item.emailTransportadora,
      subject: `Confirmação do agendamento ${item.protocolo}`,
      text: commonText,
      html: `<p>Olá, transportadora/fornecedor.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ tipo: "transportadora/fornecedor", to: item.emailTransportadora, ...sent });
    if (sent.sent) targets.push("transportadora/fornecedor");
  }

  if (item.telefoneMotorista) {
    const sentWhats = await sendWhatsApp({ to: item.telefoneMotorista, message: commonText });
    results.push({ tipo: "whatsapp-motorista", to: item.telefoneMotorista, ...sentWhats });
  }

  if (targets.length) {
    await auditLog({
      usuarioId: req.user.sub,
      perfil: req.user.perfil,
      acao: "ENVIAR_INFORMACOES",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { targets },
      ip: req.ip
    });

    if (targets.includes("transportadora/fornecedor")) {
      await auditLog({
        usuarioId: req.user.sub,
        perfil: req.user.perfil,
        acao: "ENVIAR_CONFIRMACAO",
        entidade: "AGENDAMENTO",
        entidadeId: item.id,
        detalhes: { targets: ["transportadora/fornecedor"] },
        ip: req.ip
      });
    }
  }

  return { results, links };
}

router.get("/", async (req, res) => {
  const q = req.query || {};
  const where = {
    ...(q.status ? { status: String(q.status) } : {}),
    ...(q.fornecedor ? { fornecedor: { contains: String(q.fornecedor) } } : {}),
    ...(q.transportadora ? { transportadora: { contains: String(q.transportadora) } } : {}),
    ...(q.motorista ? { motorista: { contains: String(q.motorista) } } : {}),
    ...(q.placa ? { placa: { contains: String(q.placa) } } : {}),
    ...(q.dataAgendada ? { dataAgendada: String(q.dataAgendada) } : {})
  };
  try {
    const items = await prisma.agendamento.findMany({
      where,
      include: { notasFiscais: true, documentos: true, doca: true, janela: true },
      orderBy: { id: "desc" }
    });
    const payload = await Promise.all(items.map(async (i) => enrichResponseItem({ ...calculateTotals(i.notasFiscais || [], i), ...i, semaforo: trafficColor(i.status), notificacoes: await safeNotificationSummary(i.id) })));
    return res.json(payload);
  } catch {
    try {
      const items = await fetchAgendamentosRaw(q);
      return res.json(await Promise.all(items.map((i) => enrichResponseItem({ ...i, semaforo: trafficColor(i.status), notificacoes: { ...EMPTY_NOTIFICATIONS } }))));
    } catch {}
    const items = readAgendamentos().filter((i) => (!q.status || i.status===String(q.status)) && (!q.fornecedor || String(i.fornecedor||'').toLowerCase().includes(String(q.fornecedor).toLowerCase())) && (!q.transportadora || String(i.transportadora||'').toLowerCase().includes(String(q.transportadora).toLowerCase())) && (!q.motorista || String(i.motorista||'').toLowerCase().includes(String(q.motorista).toLowerCase())) && (!q.placa || String(i.placa||'').toLowerCase().includes(String(q.placa).toLowerCase())) && (!q.dataAgendada || String(i.dataAgendada)===String(q.dataAgendada)));
    return res.json(await Promise.all(items.map((i) => enrichResponseItem({ ...i, semaforo: trafficColor(i.status), notificacoes: { ...EMPTY_NOTIFICATIONS } }))));
  }
});

router.get("/consulta-nf", async (req, res) => {
  try {
    const numeroNf = String(req.query?.numeroNf || req.query?.nf || '').trim();
    if (!numeroNf) return res.status(400).json({ message: 'Informe o número da NF para consulta.' });
    const result = await searchByNumeroNf(numeroNf);
    const agendamentos = await Promise.all((result.agendamentos || []).map(enrichResponseItem));
    return res.json({
      numeroNf,
      encontrada: (result.relatorio || []).length > 0 || agendamentos.length > 0,
      relatorio: result.relatorio || [],
      agendamentos
    });
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
});

router.post("/analise-vencimento", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    const analysis = await analyzeNotesForSchedule({
      fornecedor: payload.fornecedor || '',
      dataAgendada: payload.dataAgendada || '',
      notas: Array.isArray(payload.notasFiscais) ? payload.notasFiscais : []
    });
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/analise-vencimento", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error('Agendamento não encontrado.');
    const merged = {
      ...found,
      ...req.body,
      notasFiscais: Array.isArray(found.notasFiscais) ? found.notasFiscais : []
    };
    const analysis = await buildAwarenessAnalysisFromPayload(found, merged);
    res.json(analysis);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(await enrichResponseItem({ ...item, semaforo: trafficColor(item.status), notificacoes: await safeNotificationSummary(item.id) }));
});

router.post("/", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    payload.cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    payload.notasFiscais = await canonicalizeNotasSelecionadasComRelatorio(payload.fornecedor, Array.isArray(payload.notasFiscais) ? payload.notasFiscais : []);
    const totals = calculateTotals(Array.isArray(payload.notasFiscais) ? payload.notasFiscais : [], payload);
    Object.assign(payload, totals);
    validateAgendamentoPayload(payload, false);

    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(null, payload);
    if (awarenessAnalysis?.requiresAwareness && !payload.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data agendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }

    let defaultDoca;
    try {
      defaultDoca = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } }) || await prisma.doca.findFirst({ orderBy: { id: "asc" } });
    } catch {}
    if (!defaultDoca) {
      const items = readAgendamentos();
      defaultDoca = items.find((i) => i.docaId)?.doca ? null : null;
    }
    payload.docaId = Number(payload.docaId || defaultDoca?.id || 1);

    try { await assertJanelaDocaDisponivel({ docaId: payload.docaId, janelaId: payload.janelaId, dataAgendada: payload.dataAgendada }); } catch {}

    let item;
    try {
      item = await createAgendamentoInDatabase(payload);
    } catch (dbError) {
      console.error('Erro ao criar agendamento no banco. Usando fallback em arquivo:', dbError?.message || dbError);
      item = createAgendamentoFile({ protocolo: generateProtocol(), publicTokenMotorista: generatePublicToken("MOT", payload.cpfMotorista), publicTokenFornecedor: generatePublicToken("FOR", payload.fornecedor), checkinToken: generatePublicToken("CHK", payload.cpfMotorista || payload.placa), checkoutToken: generatePublicToken("OUT", payload.cpfMotorista || payload.placa), fornecedor: payload.fornecedor, transportadora: payload.transportadora, motorista: payload.motorista, cpfMotorista: payload.cpfMotorista || '', telefoneMotorista: payload.telefoneMotorista || '', emailMotorista: payload.emailMotorista || '', emailTransportadora: payload.emailTransportadora || '', placa: payload.placa, docaId: Number(payload.docaId), janelaId: Number(payload.janelaId), dataAgendada: payload.dataAgendada, horaAgendada: payload.horaAgendada, quantidadeNotas: Number(payload.quantidadeNotas || 0), quantidadeVolumes: Number(payload.quantidadeVolumes || 0), pesoTotalKg: Number(payload.pesoTotalKg || 0), valorTotalNf: Number(payload.valorTotalNf || 0), status: 'PENDENTE_APROVACAO', observacoes: payload.observacoes || '', notasFiscais: payload.notasFiscais || [] });
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: payload, ip: req.ip });
    try {
      await linkRelatorioRowsToAgendamento(item.id, payload.fornecedor, payload.notasFiscais || []);
    } catch (relatorioError) {
      console.error('[RELATORIO_IMPORT] Falha ao vincular notas do relatório ao agendamento:', relatorioError?.message || relatorioError);
    }
    try {
      const fullItem = await full(item.id);
      await sendFinanceAwarenessIfNeeded({ agendamento: fullItem || item, payload, actor: req.user });
      const notificacoes = await sendApprovalNotifications(fullItem || item, req);
      return res.status(201).json(await enrichResponseItem({ ...(fullItem || item), notificacoesEnviadas: notificacoes.results }));
    } catch {
      return res.status(201).json(await enrichResponseItem(item));
    }
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

async function transition(id, target, data = {}, req) {
  const found = await mustExist(id);
  if (!found) throw new Error("Agendamento não encontrado.");
  if (found.status !== target) validateStatusTransition(found.status, target);
  let updated;
  if (found.status === target) {
    updated = await mustExist(id);
  } else {
    try { updated = await prisma.agendamento.update({ where: { id: Number(id) }, data: { ...data, status: target } }); }
    catch { updated = updateAgendamentoFile(id, { ...data, status: target }); }
  }

  await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: target, entidade: "AGENDAMENTO", entidadeId: updated.id, detalhes: data, ip: req.ip });
  return updated;
}

router.post("/:id/definir-doca", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    const docaId = Number(req.body?.docaId);
    if (!docaId) throw new Error("Doca é obrigatória.");
    if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW"].includes(found.status)) {
      throw new Error("Não é possível alterar a doca para este status.");
    }

    try {
      await assertJanelaDocaDisponivel({
        docaId,
        janelaId: found.janelaId,
        dataAgendada: found.dataAgendada,
        ignoreAgendamentoId: found.id
      });
    } catch {}

    let item;
    try { item = await prisma.agendamento.update({ where: { id: found.id }, data: { docaId } }); }
    catch { item = updateAgendamentoFile(found.id, { docaId, doca: undefined }); }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "DEFINIR_DOCA", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { docaId }, ip: req.ip });
    res.json(await full(item.id));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/aprovar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");

    const data = {};
    if (req.body?.docaId) data.docaId = Number(req.body.docaId);
    if (req.body?.janelaId) data.janelaId = Number(req.body.janelaId);
    if (req.body?.dataAgendada) data.dataAgendada = String(req.body.dataAgendada);
    if (req.body?.horaAgendada) data.horaAgendada = String(req.body.horaAgendada);

    const merged = {
      ...found,
      ...data,
      notasFiscais: Array.isArray(found.notasFiscais) ? found.notasFiscais : []
    };

    if (!merged.docaId) throw new Error("Doca é obrigatória para aprovação.");
    if (!merged.janelaId) throw new Error("Janela é obrigatória para aprovação.");
    if (!merged.dataAgendada) throw new Error("Data agendada é obrigatória para aprovação.");
    if (!merged.horaAgendada) throw new Error("Hora agendada é obrigatória para aprovação.");
    if (!Array.isArray(merged.notasFiscais) || !merged.notasFiscais.length) {
      throw new Error("Selecione ao menos uma NF para o agendamento interno.");
    }

    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(found, merged);
    if (awarenessAnalysis?.requiresAwareness && !req.body?.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data agendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }

    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    const updated = await transition(req.params.id, "APROVADO", data, req);
    const item = await full(updated.id);
    await sendFinanceAwarenessIfNeeded({ agendamento: item, payload: { ...merged, confirmarCienciaVencimento: req.body?.confirmarCienciaVencimento }, actor: req.user });
    res.json(await enrichResponseItem({
      ...item,
      notificacoesEnviadas: [],
      envioAutomatico: false,
      message: "Agendamento aprovado. O e-mail com voucher só é enviado ao salvar ou ao clicar em 'Enviar informações'."
    }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/reprovar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "REPROVADO", { motivoReprovacao: req.body?.motivo || "Reprovado" }, req)); } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/reagendar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível reagendar esse status.");

    const merged = {
      ...found,
      dataAgendada: req.body?.dataAgendada || found.dataAgendada,
      horaAgendada: req.body?.horaAgendada || found.horaAgendada,
      docaId: req.body?.docaId || found.docaId,
      janelaId: req.body?.janelaId || found.janelaId
    };
    validateAgendamentoPayload(merged, false);
    const awarenessAnalysis = await buildAwarenessAnalysisFromPayload(found, merged);
    if (awarenessAnalysis?.requiresAwareness && !req.body?.confirmarCienciaVencimento) {
      return res.status(409).json({
        message: 'Existem notas com 1º vencimento muito próximo da data reagendada. Confirme a ciência para prosseguir.',
        requiresAwareness: true,
        analysis: awarenessAnalysis
      });
    }
    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    let item;
    try {
      item = await prisma.agendamento.update({
        where: { id: Number(req.params.id) },
        data: { dataAgendada: merged.dataAgendada, horaAgendada: merged.horaAgendada, docaId: Number(merged.docaId), janelaId: Number(merged.janelaId), status: "PENDENTE_APROVACAO" }
      });
    } catch {
      item = updateAgendamentoFile(req.params.id, { dataAgendada: merged.dataAgendada, horaAgendada: merged.horaAgendada, docaId: Number(merged.docaId), janelaId: Number(merged.janelaId), status: "PENDENTE_APROVACAO" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "REAGENDAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    const fullItem = await full(item.id);
    await sendFinanceAwarenessIfNeeded({ agendamento: fullItem || item, payload: { ...merged, confirmarCienciaVencimento: req.body?.confirmarCienciaVencimento }, actor: req.user });
    res.json(await enrichResponseItem(fullItem || item));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/cancelar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível cancelar esse status.");
    let item;
    try {
      item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" } });
    } catch {
      item = updateAgendamentoFile(req.params.id, { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/iniciar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "EM_DESCARGA", { inicioDescargaEm: new Date() }, req)); } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/finalizar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (found.status === "FINALIZADO") {
      return res.json({ ...found, message: "Agendamento já estava finalizado." });
    }

    const updated = await transition(req.params.id, "FINALIZADO", { fimDescargaEm: new Date() }, req);
    const item = await full(updated.id);
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "FINALIZAR_DESCARGA", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { origem: 'painel-interno' }, ip: req.ip });
    const avaliacao = await dispatchDriverFeedbackSurvey(item, req, req.user);
    res.json({ ...item, avaliacao });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/no-show", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["PENDENTE_APROVACAO", "APROVADO"].includes(found.status)) throw new Error("No-show só pode ser aplicado antes da descarga.");
    let item;
    try {
      item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "NO_SHOW" } });
    } catch {
      item = updateAgendamentoFile(req.params.id, { status: "NO_SHOW" });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "NO_SHOW", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: null, ip: req.ip });
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/checkin", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["APROVADO", "CHEGOU"].includes(found.status)) throw new Error("Check-in só é permitido para agendamento aprovado.");
    const item = await transition(req.params.id, "CHEGOU", { checkinEm: found.checkinEm || new Date() }, req);
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CHECKIN_MANUAL", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { origem: 'painel-interno' }, ip: req.ip });
    res.json({ ok: true, message: "Check-in validado pelo operador do recebimento.", agendamento: item });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/documentos", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), upload.single("arquivo"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });
    let item;
    try {
      item = await prisma.documento.create({ data: { agendamentoId: ag.id, tipoDocumento: req.body?.tipoDocumento || "ANEXO", nomeArquivo: req.file.originalname, urlArquivo: req.file.path.replace(/\\/g, "/") } });
    } catch {
      item = addDocumentoFile({ agendamentoId: ag.id, tipoDocumento: req.body?.tipoDocumento || "ANEXO", nomeArquivo: req.file.originalname, urlArquivo: req.file.path.replace(/\\/g, "/") });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "UPLOAD_DOCUMENTO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { nomeArquivo: req.file.originalname }, ip: req.ip });
    res.status(201).json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/notas", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    const payload = { ...req.body, chaveAcesso: normalizeChaveAcesso(req.body?.chaveAcesso || "") };
    validateNf(payload);
    let item;
    try {
      item = await prisma.notaFiscal.create({
        data: {
          agendamentoId: ag.id,
          numeroNf: payload.numeroNf || "",
          serie: payload.serie || "",
          chaveAcesso: payload.chaveAcesso || "",
          volumes: Number(payload.volumes || 0),
          peso: Number(payload.peso || 0),
          valorNf: Number(payload.valorNf || 0),
          observacao: payload.observacao || ""
        }
      });
    } catch {
      item = addNotaFile(ag.id, {
        numeroNf: payload.numeroNf || "",
        serie: payload.serie || "",
        chaveAcesso: payload.chaveAcesso || "",
        volumes: Number(payload.volumes || 0),
        peso: Number(payload.peso || 0),
        valorNf: Number(payload.valorNf || 0),
        observacao: payload.observacao || ""
      });
    }
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ADD_NF", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: payload, ip: req.ip });
    res.status(201).json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/enviar-informacoes", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const item = await full(req.params.id);
    if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
    const out = await sendApprovalNotifications(item, req);
    if (!out.results.length) return res.status(400).json({ message: "Não há e-mails cadastrados no agendamento." });
    res.json({ ok: true, results: out.results, ...out.links, tokenMotorista: item.publicTokenMotorista, tokenConsulta: item.publicTokenFornecedor });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/enviar-confirmacao", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const ag = await full(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!ag.emailTransportadora) return res.status(400).json({ message: "Não há e-mail da transportadora/fornecedor cadastrado." });

    const links = buildPublicLinks(req, ag);
    const pdf = await generateVoucherPdf(ag, { baseUrl: getBaseUrl(req) });
    const textoDoca = ag.doca?.codigo || "A DEFINIR";
    const scheduleIntro = buildScheduleIntro(ag);
    const sent = await sendMail({
      to: ag.emailTransportadora,
      subject: `Confirmação do agendamento ${ag.protocolo}`,
      text: `${scheduleIntro}
Protocolo: ${ag.protocolo}
Doca: ${textoDoca}
Consulta: ${links.consulta}`,
      html: `<p>${scheduleIntro}</p><p><strong>Protocolo:</strong> ${ag.protocolo}</p><p><strong>Data:</strong> ${formatDateBR(ag.dataAgendada)}</p><p><strong>Hora:</strong> ${ag.horaAgendada}</p><p><strong>Doca:</strong> ${textoDoca}</p><p><a href="${links.consulta}">Consulta do agendamento</a></p>`,
      attachments: [{ filename: `voucher-${ag.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ENVIAR_CONFIRMACAO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { targets: ["transportadora/fornecedor"] }, ip: req.ip });
    res.json({ ok: true, sent, to: ag.emailTransportadora, consulta: links.consulta, voucher: links.voucher });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/:id/qrcode.svg", async (req, res) => {
  const item = await mustExist(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const url = `${getBaseUrl(req)}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`;
  const svg = await qrSvg(url);
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

router.get("/:id/voucher", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=voucher-${item.protocolo}.pdf`);
  res.send(pdf);
});

export default router;
