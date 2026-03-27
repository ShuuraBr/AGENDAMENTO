import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generateCheckinToken } from "../utils/protocol.js";
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

async function fullAgendamento(id) {
  const item = await prisma.agendamento.findUnique({
    where: { id: Number(id) },
    include: { documentos: true }
  });
  return item;
}

router.get("/", async (_req, res) => {
  const items = await prisma.agendamento.findMany({
    include: { documentos: true },
    orderBy: { id: "desc" }
  });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const item = await fullAgendamento(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(item);
});

router.post("/", async (req, res) => {
  const item = await prisma.agendamento.create({
    data: {
      protocolo: generateProtocol(),
      checkinToken: generateCheckinToken(),
      fornecedor: req.body?.fornecedor || "",
      transportadora: req.body?.transportadora || "",
      motorista: req.body?.motorista || "",
      placa: req.body?.placa || "",
      doca: req.body?.doca || "",
      janela: req.body?.janela || "",
      dataAgendada: req.body?.dataAgendada || new Date().toISOString().slice(0, 10),
      horaAgendada: req.body?.horaAgendada || "08:00",
      quantidadeNotas: Number(req.body?.quantidadeNotas || 0),
      quantidadeVolumes: Number(req.body?.quantidadeVolumes || 0),
      status: "PENDENTE_APROVACAO",
      observacoes: req.body?.observacoes || ""
    }
  });
  res.status(201).json(item);
});

async function updateStatus(id, data, res) {
  const exists = await prisma.agendamento.findUnique({ where: { id: Number(id) } });
  if (!exists) return res.status(404).json({ message: "Agendamento não encontrado." });
  const item = await prisma.agendamento.update({ where: { id: Number(id) }, data });
  res.json(item);
}

router.post("/:id/aprovar", async (req, res) => {
  await updateStatus(req.params.id, { status: "APROVADO" }, res);
});

router.post("/:id/reprovar", async (req, res) => {
  await updateStatus(req.params.id, { status: "REPROVADO", motivoReprovacao: req.body?.motivo || "Reprovado" }, res);
});

router.post("/:id/reagendar", async (req, res) => {
  await updateStatus(req.params.id, {
    dataAgendada: req.body?.dataAgendada,
    horaAgendada: req.body?.horaAgendada,
    doca: req.body?.doca,
    janela: req.body?.janela,
    status: "PENDENTE_APROVACAO"
  }, res);
});

router.post("/:id/cancelar", async (req, res) => {
  await updateStatus(req.params.id, { status: "CANCELADO", motivoCancelamento: req.body?.motivo || "Cancelado" }, res);
});

router.post("/:id/iniciar", async (req, res) => {
  await updateStatus(req.params.id, { status: "EM_DESCARGA", inicioDescargaEm: new Date() }, res);
});

router.post("/:id/finalizar", async (req, res) => {
  await updateStatus(req.params.id, { status: "FINALIZADO", fimDescargaEm: new Date() }, res);
});

router.post("/:id/no-show", async (req, res) => {
  await updateStatus(req.params.id, { status: "NO_SHOW" }, res);
});

router.post("/:id/documentos", upload.single("arquivo"), async (req, res) => {
  const agendamento = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) } });
  if (!agendamento) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });

  const item = await prisma.documento.create({
    data: {
      agendamentoId: agendamento.id,
      tipoDocumento: req.body?.tipoDocumento || "ANEXO",
      nomeArquivo: req.file.originalname,
      urlArquivo: req.file.path.replace(/\\/g, "/")
    }
  });
  res.status(201).json(item);
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
  const item = await prisma.agendamento.findUnique({ where: { id: Number(req.params.id) } });
  if (!item) return res.status(404).send("Agendamento não encontrado.");

  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  const qrUrl = `${base}/api/agendamentos/${item.id}/qrcode.svg`;

  res.send(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8" />
      <title>Voucher ${item.protocolo}</title>
      <style>
        body { font-family: Arial; padding: 24px; }
        .card { border: 1px solid #ddd; border-radius: 12px; padding: 24px; max-width: 760px; }
        h1 { margin-top: 0; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .qr { margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Voucher de Agendamento</h1>
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
        <div class="qr">
          <p><strong>Check-in via QR Code:</strong></p>
          <img src="${qrUrl}" alt="QR Code Check-in" />
        </div>
      </div>
    </body>
    </html>
  `);
});

export default router;
