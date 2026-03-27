import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generateCheckinToken } from "../utils/protocol.js";

const router = Router();

router.post("/solicitacao", async (req, res) => {
  const item = await prisma.agendamento.create({
    data: {
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
      observacoes: req.body?.observacoes || ""
    }
  });

  res.status(201).json({
    protocolo: item.protocolo,
    status: item.status,
    checkinToken: item.checkinToken
  });
});

router.get("/motorista/:protocolo", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { protocolo: req.params.protocolo } });
  if (!item) return res.status(404).json({ message: "Protocolo não encontrado." });
  res.json(item);
});

router.post("/checkin/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });

  const updated = await prisma.agendamento.update({
    where: { id: item.id },
    data: {
      status: "CHEGOU",
      checkinEm: new Date()
    }
  });

  res.json({
    ok: true,
    message: "Check-in validado com sucesso.",
    agendamento: updated
  });
});

export default router;
