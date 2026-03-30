import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";
import { sendMail } from "../utils/email.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { auditLog } from "../utils/audit.js";

const router = Router();
router.use(authRequired);

const uploadDir = path.resolve("uploads", "documentos");
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
});
const upload = multer({ storage });

async function full(id) {
  return prisma.agendamento.findUnique({
    where: { id: Number(id) },
    include: { notasFiscais: true, documentos: true, doca: true, janela: true }
  });
}

async function mustExist(id) {
  return prisma.agendamento.findUnique({ where: { id: Number(id) } });
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

function baseUrl() {
  return process.env.FRONTEND_URL || "http://localhost:3000";
}

function verificationLinkFor(item) {
  return `${baseUrl()}/public/consulta-agendamento?token=${encodeURIComponent(item.publicTokenFornecedor)}`;
}

function driverLinkFor(item) {
  return `${baseUrl()}/public/motorista?token=${encodeURIComponent(item.publicTokenMotorista)}`;
}

function checkinLinkFor(item) {
  return `${baseUrl()}/api/public/checkin/${encodeURIComponent(item.checkinToken)}`;
}

function displayDoca(item) {
  return item?.doca?.codigo === "A DEFINIR" ? "A definir pelo operador" : (item?.doca?.codigo || "A definir");
}

function publicFields(item) {
  return {
    id: item.id,
    protocolo: item.protocolo,
    status: item.status,
    semaforo: trafficColor(item.status),
    fornecedor: item.fornecedor || "-",
    transportadora: item.transportadora || "-",
    motorista: item.motorista || "-",
    telefoneMotorista: item.telefoneMotorista || "-",
    emailMotorista: item.emailMotorista || "-",
    emailTransportadora: item.emailTransportadora || "-",
    placa: item.placa || "-",
    dataAgendada: item.dataAgendada,
    horaAgendada: item.horaAgendada,
    janela: item.janela?.codigo || "-",
    janelaDescricao: item.janela?.descricao || "-",
    doca: displayDoca(item),
    observacoes: item.observacoes || "",
    tokenVerificacao: item.publicTokenFornecedor,
    tokenMotorista: item.publicTokenMotorista,
    tokenCheckin: item.checkinToken,
    linkConsulta: verificationLinkFor(item),
    linkMotorista: driverLinkFor(item),
    linkCheckin: checkinLinkFor(item),
    notasFiscais: Array.isArray(item.notasFiscais)
      ? item.notasFiscais.map((nf) => ({
          numeroNf: nf.numeroNf || "-",
          serie: nf.serie || "-",
          chaveAcesso: nf.chaveAcesso || "-",
          volumes: nf.volumes || 0,
          peso: nf.peso || 0,
          valorNf: nf.valorNf || 0,
          observacao: nf.observacao || ""
        }))
      : []
  };
}

async function transition(id, target, data = {}, req) {
  const found = await mustExist(id);
  if (!found) throw new Error("Agendamento não encontrado.");

  if (found.status === target) {
    return prisma.agendamento.update({ where: { id: Number(id) }, data });
  }

  validateStatusTransition(found.status, target);
  const updated = await prisma.agendamento.update({ where: { id: Number(id) }, data: { ...data, status: target } });
  await auditLog({
    usuarioId: req.user.sub,
    perfil: req.user.perfil,
    acao: target,
    entidade: "AGENDAMENTO",
    entidadeId: updated.id,
    detalhes: data,
    ip: req.ip
  });
  return updated;
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
    docaDisplay: displayDoca(i),
    linkConsulta: verificationLinkFor(i),
    notificacoes: await notificationSummary(i.id)
  })));
  res.json(payload);
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json({
    ...item,
    semaforo: trafficColor(item.status),
    docaDisplay: displayDoca(item),
    linkConsulta: verificationLinkFor(item),
    notificacoes: await notificationSummary(item.id)
  });
});

router.post("/", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    validateAgendamentoPayload(payload, false);
    await assertJanelaDocaDisponivel({
      docaId: payload.docaId,
      janelaId: payload.janelaId,
      dataAgendada: payload.dataAgendada
    });

    const item = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken("MOT"),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: payload.fornecedor,
        transportadora: payload.transportadora,
        motorista: payload.motorista,
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
        status: "PENDENTE_APROVACAO",
        observacoes: payload.observacoes || ""
      }
    });

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: payload, ip: req.ip });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/definir-doca", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW"].includes(found.status)) {
      throw new Error("Não é possível redefinir a doca para este status.");
    }

    const docaId = Number(req.body?.docaId);
    if (!Number.isInteger(docaId) || docaId <= 0) {
      throw new Error("Selecione uma doca válida.");
    }

    const doca = await prisma.doca.findUnique({ where: { id: docaId } });
    if (!doca) throw new Error("Doca não encontrada.");

    await assertJanelaDocaDisponivel({
      docaId,
      janelaId: found.janelaId,
      dataAgendada: found.dataAgendada,
      ignoreAgendamentoId: found.id
    });

    const item = await prisma.agendamento.update({ where: { id: found.id }, data: { docaId } });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "DEFINIR_DOCA", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { docaId, codigo: doca.codigo }, ip: req.ip });
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
    await assertJanelaDocaDisponivel({
      docaId: merged.docaId,
      janelaId: merged.janelaId,
      dataAgendada: merged.dataAgendada,
      ignoreAgendamentoId: found.id
    });

    res.json(await transition(req.params.id, "APROVADO", data, req));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/reprovar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    res.json(await transition(req.params.id, "REPROVADO", { motivoReprovacao: req.body?.motivo || "Reprovado" }, req));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
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
    await assertJanelaDocaDisponivel({
      docaId: merged.docaId,
      janelaId: merged.janelaId,
      dataAgendada: merged.dataAgendada,
      ignoreAgendamentoId: found.id
    });

    const item = await prisma.agendamento.update({
      where: { id: Number(req.params.id) },
      data: {
        dataAgendada: merged.dataAgendada,
        horaAgendada: merged.horaAgendada,
        docaId: Number(merged.docaId),
        janelaId: Number(merged.janelaId),
        status: "PENDENTE_APROVACAO"
      }
    });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "REAGENDAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/cancelar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível cancelar esse status.");
    const item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" } });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CANCELAR", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: req.body, ip: req.ip });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/iniciar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["APROVADO", "CHEGOU", "EM_DESCARGA"].includes(found.status)) {
      throw new Error("Só é possível iniciar a descarga para agendamentos aprovados ou já chegados.");
    }
    const baseData = { inicioDescargaEm: found.inicioDescargaEm || new Date(), checkinEm: found.checkinEm || new Date() };
    res.json(await transition(req.params.id, "EM_DESCARGA", baseData, req));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/finalizar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    res.json(await transition(req.params.id, "FINALIZADO", { fimDescargaEm: new Date() }, req));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/no-show", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["PENDENTE_APROVACAO", "APROVADO", "CHEGOU"].includes(found.status)) throw new Error("No-show só pode ser aplicado antes da descarga.");
    const item = await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "NO_SHOW" } });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "NO_SHOW", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: null, ip: req.ip });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
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
    const item = await prisma.documento.create({
      data: {
        agendamentoId: ag.id,
        tipoDocumento: req.body?.tipoDocumento || "ANEXO",
        nomeArquivo: req.file.originalname,
        urlArquivo: req.file.path.replace(/\\/g, "/")
      }
    });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "UPLOAD_DOCUMENTO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { nomeArquivo: req.file.originalname }, ip: req.ip });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/notas", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    validateNf(req.body || {});
    const item = await prisma.notaFiscal.create({
      data: {
        agendamentoId: ag.id,
        numeroNf: req.body?.numeroNf || "",
        serie: req.body?.serie || "",
        chaveAcesso: normalizeChaveAcesso(req.body?.chaveAcesso || ""),
        volumes: Number(req.body?.volumes || 0),
        peso: Number(req.body?.peso || 0),
        valorNf: Number(req.body?.valorNf || 0),
        observacao: req.body?.observacao || ""
      }
    });
    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ADD_NF", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: req.body, ip: req.ip });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/enviar-informacoes", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const item = await full(req.params.id);
    if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });

    const linkMotorista = driverLinkFor(item);
    const linkFornecedor = verificationLinkFor(item);
    const voucher = `${baseUrl()}/api/agendamentos/${item.id}/voucher`;

    const destinatarios = [];
    if (item.emailMotorista) destinatarios.push({ tipo: "motorista", email: item.emailMotorista });
    if (item.emailTransportadora) destinatarios.push({ tipo: "transportadora/fornecedor", email: item.emailTransportadora });
    if (!destinatarios.length) return res.status(400).json({ message: "Não há e-mails cadastrados no agendamento." });

    const out = [];
    for (const destino of destinatarios) {
      const sent = await sendMail({
        to: destino.email,
        subject: `Voucher e dados do agendamento ${item.protocolo}`,
        text: `Protocolo: ${item.protocolo}\nToken de verificação: ${item.publicTokenFornecedor}\nConsulta da transportadora/fornecedor: ${linkFornecedor}\nAcompanhamento do motorista: ${linkMotorista}\nVoucher: ${voucher}`,
        html: `<p><strong>Protocolo:</strong> ${item.protocolo}</p><p><strong>Token de verificação:</strong> ${item.publicTokenFornecedor}</p><p><a href="${linkFornecedor}">Consulta da transportadora/fornecedor</a></p><p><a href="${linkMotorista}">Acompanhamento do motorista</a></p><p><a href="${voucher}">Voucher</a></p>`
      });
      out.push({ destino: destino.tipo, to: destino.email, ...sent });
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ENVIAR_INFORMACOES", entidade: "AGENDAMENTO", entidadeId: item.id, detalhes: { targets: destinatarios.map((d) => d.tipo) }, ip: req.ip });
    res.json({ ok: true, results: out, linkMotorista, linkFornecedor, voucher, tokenVerificacao: item.publicTokenFornecedor });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/:id/enviar-confirmacao", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const ag = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) }, include: { doca: true, janela: true } });
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!ag.emailTransportadora) return res.status(400).json({ message: "Não há e-mail da transportadora/fornecedor cadastrado." });

    const textoDoca = ag.doca?.codigo === "A DEFINIR" ? "definida pelo operador no recebimento" : (ag.doca?.codigo || "a definir");
    const linkFornecedor = verificationLinkFor(ag);
    const textMsg = `Agendamento confirmado. Protocolo ${ag.protocolo}. Data ${ag.dataAgendada} às ${ag.horaAgendada}. Doca ${textoDoca}. Token de verificação ${ag.publicTokenFornecedor}. Link ${linkFornecedor}`;
    const sent = await sendMail({
      to: ag.emailTransportadora,
      subject: `Confirmação do agendamento ${ag.protocolo}`,
      text: textMsg,
      html: `<p>Agendamento confirmado.</p><p><strong>Protocolo:</strong> ${ag.protocolo}</p><p><strong>Data:</strong> ${ag.dataAgendada}</p><p><strong>Hora:</strong> ${ag.horaAgendada}</p><p><strong>Doca:</strong> ${textoDoca}</p><p><strong>Token de verificação:</strong> ${ag.publicTokenFornecedor}</p><p><a href="${linkFornecedor}">Consultar agendamento</a></p>`
    });

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "ENVIAR_CONFIRMACAO", entidade: "AGENDAMENTO", entidadeId: ag.id, detalhes: { targets: ["transportadora/fornecedor"] }, ip: req.ip });
    res.json({ ok: true, sent, to: ag.emailTransportadora, tokenVerificacao: ag.publicTokenFornecedor, linkConsulta: linkFornecedor });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/:id/qrcode.svg", async (req, res) => {
  const item = await mustExist(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const svg = await qrSvg(checkinLinkFor(item));
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

router.get("/:id/voucher", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const qrUrl = `${baseUrl()}/api/agendamentos/${item.id}/qrcode.svg`;
  const notas = item.notasFiscais.map((n) => `<tr><td>${n.numeroNf || "-"}</td><td>${n.serie || "-"}</td><td>${n.chaveAcesso || "-"}</td><td>${n.volumes}</td></tr>`).join("");
  const consulta = verificationLinkFor(item);

  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>Voucher ${item.protocolo}</title>
  <style>body{font-family:Arial;padding:24px;background:#f8fafc}.card{border:1px solid #ddd;border-radius:12px;padding:24px;max-width:980px;margin:auto;background:#fff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table{width:100%;border-collapse:collapse;margin-top:16px}.table th,.table td{border:1px solid #ddd;padding:8px;text-align:left}.head{display:flex;justify-content:space-between;align-items:flex-start}.meta{margin-top:18px;padding:12px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px}</style></head>
  <body><div class="card"><div class="head"><div><h1>Voucher de Agendamento</h1><p>Apresente este voucher ao operador do recebimento.</p></div><img src="${baseUrl()}/assets/logo-objetiva.png" alt="Logo" style="height:84px" /></div>
  <div class="grid">
  <div><strong>Protocolo:</strong> ${item.protocolo}</div>
  <div><strong>Status:</strong> ${item.status}</div>
  <div><strong>Fornecedor:</strong> ${item.fornecedor || "-"}</div>
  <div><strong>Transportadora:</strong> ${item.transportadora || "-"}</div>
  <div><strong>Motorista:</strong> ${item.motorista || "-"}</div>
  <div><strong>Placa:</strong> ${item.placa || "-"}</div>
  <div><strong>Data:</strong> ${item.dataAgendada}</div>
  <div><strong>Hora:</strong> ${item.horaAgendada}</div>
  <div><strong>Doca:</strong> ${displayDoca(item)}</div>
  <div><strong>Janela:</strong> ${item.janela?.codigo || "-"}</div>
  </div>
  <div class="meta"><p><strong>Token de verificação:</strong> ${item.publicTokenFornecedor}</p><p><strong>Consulta da transportadora/fornecedor:</strong> <a href="${consulta}">${consulta}</a></p><p><strong>Acompanhamento do motorista:</strong> <a href="${driverLinkFor(item)}">${driverLinkFor(item)}</a></p></div>
  <h3>Notas fiscais</h3>
  <table class="table"><thead><tr><th>Número</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas || "<tr><td colspan='4'>Sem notas</td></tr>"}</tbody></table>
  <div style="margin-top:18px"><p><strong>Check-in via QR Code</strong></p><img src="${qrUrl}" alt="QR Code" /><p>Token de check-in: ${item.checkinToken}</p></div>
  </div></body></html>`);
});

export default router;
