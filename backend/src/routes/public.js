import { Router } from "express";
import { readCollection, writeCollection, nextId, nowIso } from "../utils/store.js";

const router = Router();

function protocolo() {
  return `AGD-${Date.now()}`;
}

router.post("/solicitacao", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const item = {
    id: nextId(agendamentos),
    protocolo: protocolo(),
    fornecedor: req.body?.fornecedor || "Fornecedor Externo",
    transportadora: req.body?.transportadora || "Transportadora Externa",
    motorista: req.body?.motorista || "Motorista Externo",
    placa: req.body?.placa || "SEM-PLACA",
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
  res.status(201).json({ protocolo: item.protocolo, status: item.status });
});

router.get("/motorista/:protocolo", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const item = agendamentos.find(a => a.protocolo === req.params.protocolo);
  if (!item) return res.status(404).json({ message: "Protocolo não encontrado." });
  res.json(item);
});

export default router;
