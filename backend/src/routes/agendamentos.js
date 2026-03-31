import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken, generateCpfBasedMotoristaToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";
import { sendMail } from "../utils/email.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition, normalizeChaveAcesso, normalizeCpf } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { auditLog } from "../utils/audit.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { sendWhatsApp } from "../services/whatsapp.js";

const router = Router();
router.use(authRequired);

const uploadDir = path.resolve("uploads", "documentos");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
});
const upload = multer({ storage });

async function recalculateAgendamentoTotals(agendamentoId) {
  const notas = await prisma.notaFiscal.findMany({ where: { agendamentoId: Number(agendamentoId) } });
  const totais = notas.reduce((acc, nota) => {
    acc.quantidadeNotas += 1;
    acc.quantidadeVolumes += Number(nota.volumes || 0);
    acc.pesoTotal += Number(nota.peso || 0);
    acc.valorTotal += Number(nota.valorNf || 0);
    return acc;
  }, { quantidadeNotas: 0, quantidadeVolumes: 0, pesoTotal: 0, valorTotal: 0 });

  await prisma.agendamento.update({
    where: { id: Number(agendamentoId) },
    data: {
      quantidadeNotas: totais.quantidadeNotas,
      quantidadeVolumes: totais.quantidadeVolumes,
      pesoTotal: totais.pesoTotal,
      valorTotal: totais.valorTotal
    }
  });
}

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
<<<<<<< HEAD
    checkout: `${base}/api/public/checkout/${encodeURIComponent(item.checkinToken)}`
=======
    checkout: `${base}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`
>>>>>>> 64a771ccaedbc0098087bfaf0dcf9a2de3d2e2e4
  };
}

async function full(id) {
  return prisma.agendamento.findUnique({
    where: { id: Number(id) },
    include: { notasFiscais: true, documentos: true, doca: true, janela: true }
  });
}

async function mustExist(id) {
  return prisma.agendamento.findUnique({ where: { id: Number(id) } });
}

function normalizeNotas(notas = []) {
  return Array.isArray(notas) ? notas.map((nota) => ({
    numeroNf: String(nota?.numeroNf || "").trim(),
    serie: String(nota?.serie || "").trim(),
    chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
    volumes: Number(nota?.volumes || 0),
    peso: Number(nota?.peso || 0),
    valorNf: Number(nota?.valorNf || 0),
    observacao: String(nota?.observacao || "").trim()
  })).filter((nota) => nota.numeroNf || nota.chaveAcesso) : [];
}

function summarizeNotas(notas = []) {
  return {
    quantidadeNotas: notas.length,
    quantidadeVolumes: notas.reduce((acc, nota) => acc + (Number(nota.volumes) || 0), 0),
    pesoTotalKg: Number(notas.reduce((acc, nota) => acc + (Number(nota.peso) || 0), 0).toFixed(3)),
    valorTotalNf: Number(notas.reduce((acc, nota) => acc + (Number(nota.valorNf) || 0), 0).toFixed(2))
  };
}

async function recalcAgendamentoTotals(agendamentoId) {
  const notas = await prisma.notaFiscal.findMany({ where: { agendamentoId: Number(agendamentoId) } });
  const resumo = summarizeNotas(notas);
  return prisma.agendamento.update({
    where: { id: Number(agendamentoId) },
    data: resumo
  });
}

async function resolveRelatorioTerceirizado(relatorioTerceirizadoId) {
  if (!relatorioTerceirizadoId) return null;
  return prisma.relatorioTerceirizado.findUnique({ where: { id: Number(relatorioTerceirizadoId) } });
}

async function sendCreationNotifications(item, req) {
  const links = buildPublicLinks(req, item);
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  const textoBase = [
    `Agendamento criado com sucesso.`,
    `Protocolo: ${item.protocolo}`,
    `Data: ${item.dataAgendada} às ${item.horaAgendada}`,
    `Doca: ${item.doca?.codigo || "A DEFINIR"}`,
    `Consulta: ${links.consulta}`,
    `Motorista: ${links.motorista}`,
    `Voucher: ${links.voucher}`,
    `Check-in: ${links.checkin}`,
    `Check-out: ${links.checkout}`
  ].join("\n");

  const htmlBase = `<p><strong>Agendamento criado com sucesso.</strong></p>
    <p><strong>Protocolo:</strong> ${item.protocolo}</p>
    <p><strong>Data:</strong> ${item.dataAgendada} às ${item.horaAgendada}</p>
    <p><strong>Doca:</strong> ${item.doca?.codigo || "A DEFINIR"}</p>
    <p><a href="${links.consulta}">Consulta da transportadora/fornecedor</a></p>
    <p><a href="${links.motorista}">Acompanhamento do motorista</a></p>
    <p><a href="${links.voucher}">Voucher em PDF</a></p>
    <p><a href="${links.checkin}">Check-in</a></p>
    <p><a href="${links.checkout}">Check-out</a></p>`;

  const results = [];

  if (item.emailMotorista) {
    results.push({ canal: "email", destino: item.emailMotorista, publico: "motorista", ...(await sendMail({
      to: item.emailMotorista,
      subject: `Agendamento ${item.protocolo} criado`,
      text: textoBase,
      html: htmlBase,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    })) });
  }

  if (item.emailTransportadora) {
    results.push({ canal: "email", destino: item.emailTransportadora, publico: "transportadora/fornecedor", ...(await sendMail({
      to: item.emailTransportadora,
      subject: `Agendamento ${item.protocolo} criado`,
      text: textoBase,
      html: htmlBase,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    })) });
  }

  if (item.telefoneMotorista) {
    results.push({ canal: "whatsapp", destino: item.telefoneMotorista, publico: "motorista", ...(await sendWhatsApp({
      to: item.telefoneMotorista,
      message: textoBase
    })) });
  }

  return { results, links };
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

async function sendSchedulingNotifications(item, req, context = "agendamento") {
  const links = buildPublicLinks(req, item);
  const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
  const results = [];
  const targets = [];

  const commonText = [
    `Protocolo: ${item.protocolo}`,
    `Status: ${item.status}`,
    `Consulta do fornecedor/transportadora: ${links.consulta}`,
    `Acompanhamento do motorista: ${links.motorista}`,
    `CPF do motorista: ${item.motoristaCpf || "-"}` ,
    `Token do motorista: ${item.publicTokenMotorista}` ,
    `Volumes: ${item.quantidadeVolumes || 0}` ,
    `Peso total: ${item.pesoTotal || 0}` ,
    `Valor total: ${item.valorTotal || 0}` ,
    `Voucher PDF: ${links.voucher}`,
    `Check-in: ${links.checkin}`,
    `Check-out: ${links.checkout}`
  ].join("\n");

  const commonHtml = `
    <p><strong>Protocolo:</strong> ${item.protocolo}</p>
    <p><strong>Status:</strong> ${item.status}</p>
    <p><a href="${links.consulta}">Consulta da transportadora/fornecedor</a></p>
    <p><a href="${links.motorista}">Acompanhamento do motorista</a></p>
    <p><strong>CPF do motorista:</strong> ${item.motoristaCpf || "-"}</p>
    <p><strong>Token do motorista:</strong> ${item.publicTokenMotorista}</p>
    <p><strong>Volumes:</strong> ${item.quantidadeVolumes || 0} | <strong>Peso total:</strong> ${item.pesoTotal || 0} | <strong>Valor total:</strong> ${item.valorTotal || 0}</p>
    <p><a href="${links.voucher}">Voucher em PDF</a></p>
    <p><a href="${links.checkin}">Check-in</a></p>
    <p><a href="${links.checkout}">Check-out</a></p>
  `;

  if (item.emailMotorista) {
    const sent = await sendMail({
      to: item.emailMotorista,
      subject: `${context === "aprovacao" ? "Voucher" : "Dados"} do agendamento ${item.protocolo}`,
      text: commonText,
      html: `<p>Olá, motorista.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ canal: "email", tipo: "motorista", to: item.emailMotorista, ...sent });
    if (sent.sent) targets.push("motorista-email");
  }

  if (item.emailTransportadora) {
    const sent = await sendMail({
      to: item.emailTransportadora,
      subject: `${context === "aprovacao" ? "Confirmação" : "Dados"} do agendamento ${item.protocolo}`,
      text: commonText,
      html: `<p>Olá, transportadora/fornecedor.</p>${commonHtml}`,
      attachments: [{ filename: `voucher-${item.protocolo}.pdf`, content: pdf, contentType: "application/pdf" }]
    });
    results.push({ canal: "email", tipo: "transportadora/fornecedor", to: item.emailTransportadora, ...sent });
    if (sent.sent) targets.push("transportadora-email");
  }

  const whatsappTargets = [
    item.telefoneMotorista ? { tipo: "motorista", to: item.telefoneMotorista } : null
  ].filter(Boolean);

  for (const target of whatsappTargets) {
    const sent = await sendWhatsApp({
      to: target.to,
      message: `Agendamento ${item.protocolo} | status ${item.status} | motorista ${item.motorista} | placa ${item.placa} | check-in ${links.checkin} | check-out ${links.checkout}`
    });
    results.push({ canal: "whatsapp", tipo: target.tipo, to: target.to, ...sent });
    if (sent.sent) targets.push(`${target.tipo}-whatsapp`);
  }

  if (results.length) {
    await auditLog({
      usuarioId: req.user.sub,
      perfil: req.user.perfil,
      acao: context === "aprovacao" ? "ENVIAR_INFORMACOES" : "ENVIAR_AGENDAMENTO",
      entidade: "AGENDAMENTO",
      entidadeId: item.id,
      detalhes: { context, targets, results },
      ip: req.ip
    });

    if (context === "aprovacao" && targets.some((target) => target.startsWith("transportadora"))) {
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
  const items = await prisma.agendamento.findMany({
    where,
    include: { notasFiscais: true, documentos: true, doca: true, janela: true },
    orderBy: { id: "desc" }
  });
  const payload = await Promise.all(items.map(async (i) => ({
    ...i,
    semaforo: trafficColor(i.status),
    notificacoes: await notificationSummary(i.id)
  })));
  res.json(payload);
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json({ ...item, semaforo: trafficColor(item.status), notificacoes: await notificationSummary(item.id) });
});

router.post("/", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    const relatorio = await resolveRelatorioTerceirizado(payload.relatorioTerceirizadoId);
    const notasPayload = normalizeNotas(payload.notas || (relatorio?.notasJson ? JSON.parse(relatorio.notasJson) : []));
    const resumo = summarizeNotas(notasPayload);

    const merged = {
      ...payload,
      fornecedor: String(relatorio?.fornecedor || payload.fornecedor || "").trim(),
      transportadora: String(relatorio?.transportadora || payload.transportadora || "").trim(),
      motorista: String(relatorio?.motorista || payload.motorista || "").trim(),
      cpfMotorista: normalizeCpf(relatorio?.cpfMotorista || payload.cpfMotorista || ""),
      placa: String(relatorio?.placa || payload.placa || "").trim().toUpperCase(),
      quantidadeNotas: Number(relatorio?.quantidadeNotas || payload.quantidadeNotas || resumo.quantidadeNotas || 0),
      quantidadeVolumes: Number(relatorio?.quantidadeVolumes || payload.quantidadeVolumes || resumo.quantidadeVolumes || 0),
      pesoTotalKg: Number(relatorio?.pesoTotalKg || payload.pesoTotalKg || resumo.pesoTotalKg || 0),
      valorTotalNf: Number(relatorio?.valorTotalNf || payload.valorTotalNf || resumo.valorTotalNf || 0)
    };

    validateAgendamentoPayload(merged, false);
    await assertJanelaDocaDisponivel({ docaId: merged.docaId, janelaId: merged.janelaId, dataAgendada: merged.dataAgendada });

    const item = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
<<<<<<< HEAD
        publicTokenMotorista: generateCpfBasedMotoristaToken(payload.motoristaCpf),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: payload.fornecedor,
        transportadora: payload.transportadora,
        motorista: payload.motorista,
        motoristaCpf: normalizeCpf(payload.motoristaCpf || ""),
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
        pesoTotal: Number(payload.pesoTotal || 0),
        valorTotal: Number(payload.valorTotal || 0),
=======
        publicTokenMotorista: generateDriverToken(merged.cpfMotorista),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: merged.fornecedor,
        transportadora: merged.transportadora,
        motorista: merged.motorista,
        cpfMotorista: merged.cpfMotorista || null,
        telefoneMotorista: merged.telefoneMotorista || "",
        emailMotorista: merged.emailMotorista || "",
        emailTransportadora: merged.emailTransportadora || "",
        placa: merged.placa,
        docaId: Number(merged.docaId),
        janelaId: Number(merged.janelaId),
        dataAgendada: merged.dataAgendada,
        horaAgendada: merged.horaAgendada,
        quantidadeNotas: Number(merged.quantidadeNotas || 0),
        quantidadeVolumes: Number(merged.quantidadeVolumes || 0),
        pesoTotalKg: Number(merged.pesoTotalKg || 0),
        valorTotalNf: Number(merged.valorTotalNf || 0),
>>>>>>> 64a771ccaedbc0098087bfaf0dcf9a2de3d2e2e4
        status: "PENDENTE_APROVACAO",
        observacoes: merged.observacoes || ""
      }
    });

<<<<<<< HEAD
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: payload, ip: req.ip });
    const created = await full(item.id);
    const notificacoes = await sendSchedulingNotifications(created, req, "agendamento");
    res.status(201).json({ ...created, notificacoesEnviadas: notificacoes.results, links: notificacoes.links });
=======
    if (notasPayload.length) {
      await prisma.notaFiscal.createMany({
        data: notasPayload.map((nota) => ({ ...nota, agendamentoId: item.id }))
      });
    }

    if (relatorio) {
      await prisma.relatorioTerceirizado.update({
        where: { id: relatorio.id },
        data: { agendamentoId: item.id, status: "AGENDADO" }
      });
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: merged, ip: req.ip });
    const detailed = await full(item.id);
    const notificacoes = await sendCreationNotifications(detailed, req);
    res.status(201).json({ ...detailed, notificacoes });
>>>>>>> 64a771ccaedbc0098087bfaf0dcf9a2de3d2e2e4
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

async function transition(id, target, data = {}, req) {
  const found = await mustExist(id);
  if (!found) throw new Error("Agendamento não encontrado.");
  if (found.status !== target) validateStatusTransition(found.status, target);
  const updated = found.status === target
    ? await prisma.agendamento.findUnique({ where: { id: Number(id) } })
    : await prisma.agendamento.update({ where: { id: Number(id) }, data: { ...data, status: target } });

  await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: target, entidade: "AGENDAMENTO", entidadeId: updated.id, detalhes: data, ip: req.ip });
  return updated;
}

router.post("/:id/definir-doca", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await full(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (found.status !== "CHEGOU") throw new Error("A doca só pode ser definida quando o agendamento estiver com status CHEGOU.");
    const docaId = Number(req.body?.docaId);
    if (!docaId) throw new Error("Doca é obrigatória.");

    await assertJanelaDocaDisponivel({
      docaId,
      janelaId: found.janelaId,
      dataAgendada: found.dataAgendada,
      ignoreAgendamentoId: found.id
    });

    const item = await prisma.agendamento.update({ where: { id: found.id }, data: { docaId } });
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
    const notificacoes = await sendSchedulingNotifications(item, req, "aprovacao");
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
router.post("/:id/checkout", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["CHEGOU", "EM_DESCARGA"].includes(found.status)) throw new Error("Check-out só é permitido após a chegada.");
    const item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "FINALIZADO", inicioDescargaEm: found.inicioDescargaEm || found.checkinEm || new Date(), fimDescargaEm: new Date() } });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CHECKOUT", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: null, ip: req.ip });
    res.json({ ok: true, message: "Check-out validado com sucesso.", agendamento: item });
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
<<<<<<< HEAD
    await recalculateAgendamentoTotals(ag.id);
=======
    await recalcAgendamentoTotals(ag.id);
>>>>>>> 64a771ccaedbc0098087bfaf0dcf9a2de3d2e2e4
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ADD_NF", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: payload, ip: req.ip });
    res.status(201).json(item);
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/enviar-informacoes", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const item = await full(req.params.id);
    if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
    const out = await sendSchedulingNotifications(item, req, "aprovacao");
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

router.get("/:id/checkout-qrcode.svg", async (req, res) => {
  const item = await mustExist(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
<<<<<<< HEAD
  const url = `OUT-${item.id}-${item.checkinToken}`;
=======
  const url = `${getBaseUrl(req)}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`;
>>>>>>> 64a771ccaedbc0098087bfaf0dcf9a2de3d2e2e4
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
