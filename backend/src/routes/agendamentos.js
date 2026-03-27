import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { authRequired } from "../middlewares/auth.js";
import { readCollection, writeCollection, nextId, nowIso } from "../utils/store.js";

const router = Router();
const uploadDir = path.resolve("uploads", "documentos");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
});
const upload = multer({ storage });

router.use(authRequired);

function protocolo() {
  return `AGD-${Date.now()}`;
}

router.get("/", (_req, res) => {
  const agendamentos = readCollection("agendamentos");
  const documentos = readCollection("documentos");
  res.json(agendamentos.map(a => ({ ...a, documentos: documentos.filter(d => d.agendamentoId === a.id) })));
});

router.post("/", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const item = {
    id: nextId(agendamentos),
    protocolo: protocolo(),
    fornecedor: req.body?.fornecedor || "Fornecedor Exemplo",
    transportadora: req.body?.transportadora || "Transportadora Exemplo",
    motorista: req.body?.motorista || "Motorista Exemplo",
    placa: req.body?.placa || "ABC1D23",
    dataAgendada: req.body?.dataAgendada || new Date().toISOString().slice(0, 10),
    horaAgendada: req.body?.horaAgendada || "08:00",
    quantidadeNotas: Number(req.body?.quantidadeNotas || 1),
    quantidadeVolumes: Number(req.body?.quantidadeVolumes || 1),
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
  const agendamentos = readCollection("agendamentos");
  const idx = agendamentos.findIndex(a => a.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  agendamentos[idx].status = "APROVADO";
  agendamentos[idx].updatedAt = nowIso();
  writeCollection("agendamentos", agendamentos);
  res.json(agendamentos[idx]);
});

router.post("/:id/cancelar", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const idx = agendamentos.findIndex(a => a.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  agendamentos[idx].status = "CANCELADO";
  agendamentos[idx].updatedAt = nowIso();
  agendamentos[idx].motivoCancelamento = req.body?.motivo || "Cancelado manualmente";
  writeCollection("agendamentos", agendamentos);
  res.json(agendamentos[idx]);
});

router.post("/:id/reagendar", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const idx = agendamentos.findIndex(a => a.id === Number(req.params.id));
  if (idx < 0) return res.status(404).json({ message: "Agendamento não encontrado." });
  agendamentos[idx].dataAgendada = req.body?.dataAgendada || agendamentos[idx].dataAgendada;
  agendamentos[idx].horaAgendada = req.body?.horaAgendada || agendamentos[idx].horaAgendada;
  agendamentos[idx].status = "PENDENTE_APROVACAO";
  agendamentos[idx].updatedAt = nowIso();
  writeCollection("agendamentos", agendamentos);
  res.json(agendamentos[idx]);
});

router.post("/:id/documentos", upload.single("arquivo"), (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const ag = agendamentos.find(a => a.id === Number(req.params.id));
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });

  const documentos = readCollection("documentos");
  const item = {
    id: nextId(documentos),
    agendamentoId: ag.id,
    tipoDocumento: req.body?.tipoDocumento || "ANEXO",
    nomeArquivo: req.file.originalname,
    urlArquivo: req.file.path.replace(/\\/g, "/"),
    createdAt: nowIso()
  };
  documentos.push(item);
  writeCollection("documentos", documentos);
  res.status(201).json(item);
});

export default router;
