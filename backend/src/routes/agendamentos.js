import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";
import { sendMail } from "../utils/email.js";
import { validateAgendamentoPayload, validateNf, validateStatusTransition } from "../utils/validators.js";

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
    include: { notasFiscais: true, documentos: true }
  });
}

async function mustExist(id) {
  return prisma.agendamento.findUnique({ where: { id: Number(id) } });
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
  res.json(await prisma.agendamento.findMany({
    where,
    include: { notasFiscais: true, documentos: true },
    orderBy: { id: "desc" }
  }));
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(item);
});

router.post("/", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const payload = req.body || {};
    validateAgendamentoPayload(payload, false);
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
        doca: payload.doca || "",
        janela: payload.janela || "",
        dataAgendada: payload.dataAgendada,
        horaAgendada: payload.horaAgendada,
        quantidadeNotas: Number(payload.quantidadeNotas || 0),
        quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
        status: "PENDENTE_APROVACAO",
        observacoes: payload.observacoes || ""
      }
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

async function transition(id, target, data = {}) {
  const found = await mustExist(id);
  if (!found) throw new Error("Agendamento não encontrado.");
  validateStatusTransition(found.status, target);
  return prisma.agendamento.update({ where: { id: Number(id) }, data: { ...data, status: target } });
}

router.post("/:id/aprovar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "APROVADO")); } catch (err) { res.status(400).json({ message: err.message }); }
});
router.post("/:id/reprovar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "REPROVADO", { motivoReprovacao: req.body?.motivo || "Reprovado" })); } catch (err) { res.status(400).json({ message: err.message }); }
});
router.post("/:id/reagendar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível reagendar esse status.");
    validateAgendamentoPayload({ ...found, ...req.body }, false);
    res.json(await prisma.agendamento.update({
      where: { id: Number(req.params.id) },
      data: {
        dataAgendada: req.body?.dataAgendada || found.dataAgendada,
        horaAgendada: req.body?.horaAgendada || found.horaAgendada,
        doca: req.body?.doca || found.doca,
        janela: req.body?.janela || found.janela,
        status: "PENDENTE_APROVACAO"
      }
    }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});
router.post("/:id/cancelar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (["FINALIZADO", "CANCELADO"].includes(found.status)) throw new Error("Não é possível cancelar esse status.");
    res.json(await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" } }));
  } catch (err) { res.status(400).json({ message: err.message }); }
});
router.post("/:id/iniciar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "EM_DESCARGA", { inicioDescargaEm: new Date() })); } catch (err) { res.status(400).json({ message: err.message }); }
});
router.post("/:id/finalizar", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try { res.json(await transition(req.params.id, "FINALIZADO", { fimDescargaEm: new Date() })); } catch (err) { res.status(400).json({ message: err.message }); }
});
router.post("/:id/no-show", requireProfiles("ADMIN", "OPERADOR", "GESTOR", "PORTARIA"), async (req, res) => {
  try {
    const found = await mustExist(req.params.id);
    if (!found) throw new Error("Agendamento não encontrado.");
    if (!["PENDENTE_APROVACAO", "APROVADO"].includes(found.status)) throw new Error("No-show só pode ser aplicado antes da descarga.");
    res.json(await prisma.agendamento.update({ where: { id: Number(req.params.id) }, data: { status: "NO_SHOW" } }));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/documentos", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), upload.single("arquivo"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });
    res.status(201).json(await prisma.documento.create({
      data: {
        agendamentoId: ag.id,
        tipoDocumento: req.body?.tipoDocumento || "ANEXO",
        nomeArquivo: req.file.originalname,
        urlArquivo: req.file.path.replace(/\\/g, "/")
      }
    }));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/notas", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const ag = await mustExist(req.params.id);
    if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
    validateNf(req.body || {});
    res.status(201).json(await prisma.notaFiscal.create({
      data: {
        agendamentoId: ag.id,
        numeroNf: req.body?.numeroNf || "",
        serie: req.body?.serie || "",
        chaveAcesso: req.body?.chaveAcesso || "",
        volumes: Number(req.body?.volumes || 0),
        peso: Number(req.body?.peso || 0),
        valorNf: Number(req.body?.valorNf || 0),
        observacao: req.body?.observacao || ""
      }
    }));
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.post("/:id/enviar-informacoes", requireProfiles("ADMIN", "OPERADOR", "GESTOR"), async (req, res) => {
  try {
    const item = await full(req.params.id);
    if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });

    const base = process.env.FRONTEND_URL || "http://localhost:3000";
    const linkMotorista = `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`;
    const linkFornecedor = `${base}/?view=fornecedor&token=${encodeURIComponent(item.publicTokenFornecedor)}`;
    const voucher = `${base}/api/agendamentos/${item.id}/voucher`;

    const targets = [item.emailMotorista, item.emailTransportadora].filter(Boolean);
    if (!targets.length) return res.status(400).json({ message: "Não há e-mails cadastrados no agendamento." });

    const out = [];
    for (const to of targets) {
      const sent = await sendMail({
        to,
        subject: `Agendamento ${item.protocolo}`,
        text: `Protocolo: ${item.protocolo}\nMotorista: ${linkMotorista}\nFornecedor: ${linkFornecedor}\nVoucher: ${voucher}`,
        html: `<p><strong>Protocolo:</strong> ${item.protocolo}</p><p><a href="${linkMotorista}">Link do motorista</a></p><p><a href="${linkFornecedor}">Link do fornecedor/transportadora</a></p><p><a href="${voucher}">Voucher</a></p>`
      });
      out.push({ to, ...sent });
    }
    res.json({ ok: true, results: out, linkMotorista, linkFornecedor, voucher });
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get("/:id/qrcode.svg", async (req, res) => {
  const item = await mustExist(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  const url = `${base}/?view=checkin&token=${encodeURIComponent(item.checkinToken)}`;
  const svg = await qrSvg(url);
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

router.get("/:id/voucher", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  const qrUrl = `${base}/api/agendamentos/${item.id}/qrcode.svg`;
  const notas = item.notasFiscais.map(n => `<tr><td>${n.numeroNf || "-"}</td><td>${n.serie || "-"}</td><td>${n.chaveAcesso || "-"}</td><td>${n.volumes}</td></tr>`).join("");

  res.send(`<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8" /><title>Voucher ${item.protocolo}</title>
  <style>body{font-family:Arial;padding:24px;background:#f8fafc}.card{border:1px solid #ddd;border-radius:12px;padding:24px;max-width:980px;margin:auto;background:#fff}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table{width:100%;border-collapse:collapse;margin-top:16px}.table th,.table td{border:1px solid #ddd;padding:8px;text-align:left}.head{display:flex;justify-content:space-between;align-items:flex-start}</style></head>
  <body><div class="card"><div class="head"><div><h1>Voucher de Agendamento</h1><p>Apresente este voucher no recebimento.</p></div><img src="${base}/assets/logo-objetiva.png" alt="Logo" style="height:84px" /></div>
  <div class="grid">
  <div><strong>Protocolo:</strong> ${item.protocolo}</div>
  <div><strong>Status:</strong> ${item.status}</div>
  <div><strong>Fornecedor:</strong> ${item.fornecedor || "-"}</div>
  <div><strong>Transportadora:</strong> ${item.transportadora || "-"}</div>
  <div><strong>Motorista:</strong> ${item.motorista || "-"}</div>
  <div><strong>Placa:</strong> ${item.placa || "-"}</div>
  <div><strong>Data:</strong> ${item.dataAgendada}</div>
  <div><strong>Hora:</strong> ${item.horaAgendada}</div>
  <div><strong>Doca:</strong> ${item.doca || "-"}</div>
  <div><strong>Janela:</strong> ${item.janela || "-"}</div>
  </div>
  <h3>Notas fiscais</h3>
  <table class="table"><thead><tr><th>Número</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas || "<tr><td colspan='4'>Sem notas</td></tr>"}</tbody></table>
  <div style="margin-top:18px"><p><strong>Check-in via QR Code</strong></p><img src="${qrUrl}" alt="QR Code" /></div>
  </div></body></html>`);
});

export default router;
