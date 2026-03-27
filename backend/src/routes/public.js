import { Router } from "express";
import { readCollection, writeCollection, nextId, nowIso } from "../utils/store.js";
import { generateProtocol, generateCheckinToken } from "../utils/protocol.js";

const router = Router();

router.post("/solicitacao", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const item = {
    id: nextId(agendamentos),
    protocolo: generateProtocol(),
    checkinToken: generateCheckinToken(),
    fornecedor: req.body?.fornecedor || "Fornecedor Externo",
    transportadora: req.body?.transportadora || "Transportadora Externa",
    motorista: req.body?.motorista || "Motorista Externo",
    placa: req.body?.placa || "",
    doca: req.body?.doca || "",
    janela: req.body?.janela || "",
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
  res.status(201).json({ protocolo: item.protocolo, status: item.status, checkinToken: item.checkinToken });
});

router.get("/motorista/:protocolo", (req, res) => {
  const item = readCollection("agendamentos").find(x => x.protocolo === req.params.protocolo);
  if (!item) return res.status(404).json({ message: "Protocolo não encontrado." });
  res.json(item);
});

router.post("/checkin/:token", (req, res) => {
  const agendamentos = readCollection("agendamentos");
  const idx = agendamentos.findIndex(x => x.checkinToken === req.params.token);
  if (idx < 0) return res.status(404).json({ message: "Token de check-in inválido." });

  agendamentos[idx].status = "CHEGOU";
  agendamentos[idx].checkinEm = nowIso();
  agendamentos[idx].updatedAt = nowIso();
  writeCollection("agendamentos", agendamentos);

  res.json({
    ok: true,
    message: "Check-in validado com sucesso.",
    agendamento: agendamentos[idx]
  });
});

export default router;
