import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { authRequired } from "../middlewares/auth.js";
import { readCollection, writeCollection, nextId, nowIso } from "../utils/store.js";
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

function enrich(item) {
  const docs = readCollection("documentos").filter(d => d.agendamentoId === item.id);
  return { ...item, documentos: docs };
}

router.get("/", (_req, res) => {
  res.json(readCollection("agendamentos").map(enrich));
});

router.get("/:id", (req, res) => {
  const item = readCollection("agendamentos").find(x => x.id === Number(req.params.id));
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(enrich(item));
});

router.post("/", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const item = {
    id: nextId(agendamentos),
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
    observacoes: req.body?.observacoes || "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  agendamentos.push(item);
  writeCollection("agendamentos", agendamentos);
  res.status(201).json(item);
});

router.post("/:id/aprovar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "APROVADO";
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/reprovar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "REPROVADO";
  items[idx].motivoReprovacao = req.body?.motivo || "Reprovado";
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/reagendar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].dataAgendada = req.body?.dataAgendada || items[idx].dataAgendada;
  items[idx].horaAgendada = req.body?.horaAgendada || items[idx].horaAgendada;
  items[idx].doca = req.body?.doca || items[idx].doca;
  items[idx].janela = req.body?.janela || items[idx].janela;
  items[idx].status = "PENDENTE_APROVACAO";
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/cancelar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "CANCELADO";
  items[idx].motivoCancelamento = req.body?.motivo || "Cancelado";
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/iniciar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "EM_DESCARGA";
  items[idx].inicioDescargaEm = nowIso();
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/finalizar", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "FINALIZADO";
  items[idx].fimDescargaEm = nowIso();
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/no-show", (req, res) => {
  const items = readCollection("agendamentos");
  const idx = items.findIndex(x => x.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  items[idx].status = "NO_SHOW";
  items[idx].updatedAt = nowIso();
  writeCollection("agendamentos", items);
  res.json(items[idx]);
});

router.post("/:id/documentos", upload.single("arquivo"), (req, res) => {
  const agendamento = readCollection("agendamentos").find(x => x.id === Number(req.params.id));
  if (!agendamento) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });

  const documentos = readCollection("documentos");
  const item = {
    id: nextId(documentos),
    agendamentoId: agendamento.id,
    tipoDocumento: req.body?.tipoDocumento || "ANEXO",
    nomeArquivo: req.file.originalname,
    urlArquivo: req.file.path.replace(/\\/g, "/"),
    createdAt: nowIso()
  };
  documentos.push(item);
  writeCollection("documentos", documentos);
  res.status(201).json(item);
});

router.get("/:id/qrcode.svg", async (req, res) => {
  const item = readCollection("agendamentos").find(x => x.id === Number(req.params.id));
  if (!item) return res.status(404).send("Agendamento não encontrado.");
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  const url = `${base}/?view=checkin&token=${encodeURIComponent(item.checkinToken)}`;
  const svg = await qrSvg(url);
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

router.get("/:id/voucher", async (req, res) => {
  const item = readCollection("agendamentos").find(x => x.id === Number(req.params.id));
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
