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
import { readAgendamentos, findAgendamentoFile, updateAgendamentoFile, createAgendamentoFile } from "../utils/file-store.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { auditLog } from "../utils/audit.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { fetchAgendamentosRaw } from "../utils/db-fallback.js";

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

async function sendApprovalNotifications(item, req) {
  const links = buildPublicLinks(req, item);
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  const results = [];
  const targets = [];

  const commonText = [
    `Protocolo: ${item.protocolo}`,
    `Consulta do fornecedor/transportadora: ${links.consulta}`,
    `Acompanhamento do motorista: ${links.motorista}`,
    `Token do motorista: ${item.publicTokenMotorista}`,
    `Voucher PDF: ${links.voucher}`,
    `Check-in: ${links.checkin}`,
    `Check-out: ${links.checkout}`
  ].join("\n");

  const commonHtml = `
    <p><strong>Protocolo:</strong> ${item.protocolo}</p>
    <p><a href="${links.consulta}">Consulta da transportadora/fornecedor</a></p>
    <p><a href="${links.motorista}">Acompanhamento do motorista</a></p>
    <p><strong>Token do motorista:</strong> ${item.publicTokenMotorista}</p>
    <p><a href="${links.voucher}">Voucher em PDF</a></p>
    <p><a href="${links.checkin}">Check-in</a></p><p><a href="${links.checkout}">Check-out</a></p>
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
    const payload = await Promise.all(items.map(async (i) => ({ ...calculateTotals(i.notasFiscais || [], i), ...i, semaforo: trafficColor(i.status), notificacoes: await notificationSummary(i.id) })));
    return res.json(payload);
  } catch {
    try {
      const items = await fetchAgendamentosRaw(q);
      return res.json(items.map((i) => ({ ...i, semaforo: trafficColor(i.status), notificacoes: { voucherMotorista:false,voucherTransportadoraFornecedor:false,confirmacaoTransportadoraFornecedor:false } })));
    } catch {}
    const items = readAgendamentos().filter((i) => (!q.status || i.status===String(q.status)) && (!q.fornecedor || String(i.fornecedor||'').toLowerCase().includes(String(q.fornecedor).toLowerCase())) && (!q.transportadora || String(i.transportadora||'').toLowerCase().includes(String(q.transportadora).toLowerCase())) && (!q.motorista || String(i.motorista||'').toLowerCase().includes(String(q.motorista).toLowerCase())) && (!q.placa || String(i.placa||'').toLowerCase().includes(String(q.placa).toLowerCase())) && (!q.dataAgendada || String(i.dataAgendada)===String(q.dataAgendada)));
    return res.json(items.map((i) => ({ ...i, semaforo: trafficColor(i.status), notificacoes: { voucherMotorista:false,voucherTransportadoraFornecedor:false,confirmacaoTransportadoraFornecedor:false } })));
  }
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json({ ...item, semaforo: trafficColor(item.status), notificacoes: await notificationSummary(item.id) });
});

router.post("/", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    payload.cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    const totals = calculateTotals(Array.isArray(payload.notasFiscais) ? payload.notasFiscais : [], payload);
    Object.assign(payload, totals);
    validateAgendamentoPayload(payload, false);

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
      item = await prisma.agendamento.create({
        data: {
          protocolo: generateProtocol(),
          publicTokenMotorista: generatePublicToken("MOT", payload.cpfMotorista),
          publicTokenFornecedor: generatePublicToken("FOR", payload.fornecedor),
          checkinToken: generatePublicToken("CHK", payload.cpfMotorista || payload.placa),
          checkoutToken: generatePublicToken("OUT", payload.cpfMotorista || payload.placa),
          fornecedor: payload.fornecedor,
          transportadora: payload.transportadora,
          motorista: payload.motorista,
          cpfMotorista: payload.cpfMotorista || "",
          telefoneMotorista: payload.telefoneMotorista || "",
          emailMotorista: payload.emailMotorista || "",
          emailTransportadora: payload.emailTransportadora || "",
          placa: payload.placa,
          docaId: Number(payload.docaId), janelaId: Number(payload.janelaId), dataAgendada: payload.dataAgendada, horaAgendada: payload.horaAgendada,
          quantidadeNotas: Number(payload.quantidadeNotas || 0), quantidadeVolumes: Number(payload.quantidadeVolumes || 0), pesoTotalKg: Number(payload.pesoTotalKg || 0), valorTotalNf: Number(payload.valorTotalNf || 0),
          status: "PENDENTE_APROVACAO", observacoes: payload.observacoes || ""
        }
      });
    } catch {
      item = createAgendamentoFile({ protocolo: generateProtocol(), publicTokenMotorista: generatePublicToken("MOT", payload.cpfMotorista), publicTokenFornecedor: generatePublicToken("FOR", payload.fornecedor), checkinToken: generatePublicToken("CHK", payload.cpfMotorista || payload.placa), checkoutToken: generatePublicToken("OUT", payload.cpfMotorista || payload.placa), fornecedor: payload.fornecedor, transportadora: payload.transportadora, motorista: payload.motorista, cpfMotorista: payload.cpfMotorista || '', telefoneMotorista: payload.telefoneMotorista || '', emailMotorista: payload.emailMotorista || '', emailTransportadora: payload.emailTransportadora || '', placa: payload.placa, docaId: Number(payload.docaId), janelaId: Number(payload.janelaId), dataAgendada: payload.dataAgendada, horaAgendada: payload.horaAgendada, quantidadeNotas: Number(payload.quantidadeNotas || 0), quantidadeVolumes: Number(payload.quantidadeVolumes || 0), pesoTotalKg: Number(payload.pesoTotalKg || 0), valorTotalNf: Number(payload.valorTotalNf || 0), status: 'PENDENTE_APROVACAO', observacoes: payload.observacoes || '', notasFiscais: payload.notasFiscais || [] });
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: payload, ip: req.ip });
    try { const fullItem = await full(item.id); const notificacoes = await sendApprovalNotifications(fullItem || item, req); return res.status(201).json({ ...(fullItem || item), notificacoesEnviadas: notificacoes.results }); } catch { return res.status(201).json(item); }
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
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");

    const data = {};
    if (req.body?.docaId) data.docaId = Number(req.body.docaId);
    if (req.body?.janelaId) data.janelaId = Number(req.body.janelaId);
    if (req.body?.dataAgendada) data.dataAgendada = String(req.body.dataAgendada);
    if (req.body?.horaAgendada) data.horaAgendada = String(req.body.horaAgendada);

    const merged = { ...found, ...data };
    validateAgendamentoPayload(merged, false);
    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    const updated = await transition(req.params.id, "APROVADO", data, req);
    const item = await full(updated.id);
    const notificacoes = await sendApprovalNotifications(item, req);
    res.json({ ...item, notificacoesEnviadas: notificacoes.results, links: notificacoes.links });
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
    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada, ignoreAgendamentoId: found.id });

    const item = await prisma.agendamento.update({
      where: { id: Number(req.params.id) },
      data: { dataAgendada: merged.dataAgendada, horaAgendada: merged.horaAgendada, docaId: Number(merged.docaId), janelaId: Number(merged.janelaId), status: "PENDENTE_APROVACAO" }
    });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "REAGENDAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/cancelar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível cancelar esse status.");
    const item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" } });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    res.json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/iniciar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "EM_DESCARGA", { inicioDescargaEm: new Date() }, req)); } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/finalizar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "FINALIZADO", { fimDescargaEm: new Date() }, req)); } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/no-show", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["PENDENTE_APROVACAO", "APROVADO"].includes(found.status)) throw new Error("No-show só pode ser aplicado antes da descarga.");
    const item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "NO_SHOW" } });
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
    const item = await prisma.documento.create({ data: { agendamentoId: ag.id, tipoDocumento: req.body?.tipoDocumento || "ANEXO", nomeArquivo: req.file.originalname, urlArquivo: req.file.path.replace(/\\/g, "/") } });
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
    const item = await prisma.notaFiscal.create({
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
    const sent = await sendMail({
      to: ag.emailTransportadora,
      subject: `Confirmação do agendamento ${ag.protocolo}`,
      text: `Agendamento confirmado. Protocolo ${ag.protocolo}. Data ${ag.dataAgendada} às ${ag.horaAgendada}. Doca ${textoDoca}. Consulta: ${links.consulta}`,
      html: `<p>Agendamento confirmado.</p><p><strong>Protocolo:</strong> ${ag.protocolo}</p><p><strong>Data:</strong> ${ag.dataAgendada}</p><p><strong>Hora:</strong> ${ag.horaAgendada}</p><p><strong>Doca:</strong> ${textoDoca}</p><p><a href="${links.consulta}">Consulta do agendamento</a></p>`,
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
