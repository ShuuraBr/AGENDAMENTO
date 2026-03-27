import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { qrSvg } from "../utils/qrcode.js";

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

router.get("/", async (_req, res) => {
  res.json(await prisma.agendamento.findMany({
    include: { notasFiscais: true, documentos: true },
    orderBy: { id: "desc" }
  }));
});

router.get("/:id", async (req, res) => {
  const item = await full(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(item);
});

router.post("/", async (req, res) => {
  const payload = req.body || {};
  const item = await prisma.agendamento.create({
    data: {
      protocolo: generateProtocol(),
      publicTokenMotorista: generatePublicToken("MOT"),
      publicTokenFornecedor: generatePublicToken("FOR"),
      checkinToken: generatePublicToken("CHK"),
      fornecedor: payload.fornecedor || "",
      transportadora: payload.transportadora || "",
      motorista: payload.motorista || "",
      telefoneMotorista: payload.telefoneMotorista || "",
      placa: payload.placa || "",
      doca: payload.doca || "",
      janela: payload.janela || "",
      dataAgendada: payload.dataAgendada || new Date().toISOString().slice(0, 10),
      horaAgendada: payload.horaAgendada || "08:00",
      quantidadeNotas: Number(payload.quantidadeNotas || 0),
      quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
      status: "PENDENTE_APROVACAO",
      observacoes: payload.observacoes || ""
    }
  });
  res.status(201).json(item);
});

async function setStatus(id, data, res) {
  const found = await prisma.agendamento.findUnique({ where: { id: Number(id) } });
  if (!found) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(await prisma.agendamento.update({ where: { id: Number(id) }, data }));
}

router.post("/:id/aprovar", async (req, res) => setStatus(req.params.id, { status: "APROVADO" }, res));
router.post("/:id/reprovar", async (req, res) => setStatus(req.params.id, { status: "REPROVADO", motivoReprovacao: req.body?.motivo || "Reprovado" }, res));
router.post("/:id/reagendar", async (req, res) => setStatus(req.params.id, {
  status: "PENDENTE_APROVACAO",
  dataAgendada: req.body?.dataAgendada,
  horaAgendada: req.body?.horaAgendada,
  doca: req.body?.doca,
  janela: req.body?.janela
}, res));
router.post("/:id/cancelar", async (req, res) => setStatus(req.params.id, { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" }, res));
router.post("/:id/iniciar", async (req, res) => setStatus(req.params.id, { status: "EM_DESCARGA", inicioDescargaEm: new Date() }, res));
router.post("/:id/finalizar", async (req, res) => setStatus(req.params.id, { status: "FINALIZADO", fimDescargaEm: new Date() }, res));
router.post("/:id/no-show", async (req, res) => setStatus(req.params.id, { status: "NO_SHOW" }, res));

router.post("/:id/documentos", upload.single("arquivo"), async (req, res) => {
  const ag = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) } });
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
});

router.post("/:id/notas", async (req, res) => {
  const ag = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) } });
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });

  const payload = req.body || {};
  if (!payload.numeroNf && !payload.chaveAcesso) {
    return res.status(400).json({ message: "Informe ao menos o número da NF ou a chave de acesso." });
  }
  if (payload.chaveAcesso && String(payload.chaveAcesso).replace(/\D/g, "").length !== 44) {
    return res.status(400).json({ message: "A chave de acesso deve ter 44 dígitos." });
  }

  res.status(201).json(await prisma.notaFiscal.create({
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
  }));
});

router.get("/:id/qrcode.svg", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) } });
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
  <style>body{font-family:Arial;padding:24px}.card{border:1px solid #ddd;border-radius:12px;padding:24px;max-width:900px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.table{width:100%;border-collapse:collapse;margin-top:16px}.table th,.table td{border:1px solid #ddd;padding:8px;text-align:left}</style></head>
  <body><div class="card"><h1>Voucher de Agendamento</h1>
  <div class="grid">
  <div><strong>Protocolo:</strong> ${item.protocolo}</div>
  <div><strong>Status:</strong> ${item.status}</div>
  <div><strong>Fornecedor:</strong> ${item.fornecedor || "-"}</div>
  <div><strong>Transportadora:</strong> ${item.transportadora || "-"}</div>
  <div><strong>Motorista:</strong> ${item.motorista || "-"}</div>
  <div><strong>Placa:</strong> ${item.placa || "-"}</div>
  <div><strong>Data:</strong> ${item.dataAgendada}</div>
  <div><strong>Hora:</strong> ${item.horaAgendada}</div>
  </div>
  <h3>Notas fiscais</h3>
  <table class="table"><thead><tr><th>Número</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas || "<tr><td colspan='4'>Sem notas</td></tr>"}</tbody></table>
  <div style="margin-top:16px"><img src="${qrUrl}" alt="QR Code" /></div>
  </div></body></html>`);
});

export default router;
