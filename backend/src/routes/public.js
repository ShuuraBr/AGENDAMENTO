import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";

const router = Router();

router.post("/solicitacao", async (req, res) => {
  const p = req.body || {};
  if (!p.lgpdConsent) return res.status(400).json({ message: "É obrigatório aceitar o termo LGPD." });

  const ag = await prisma.agendamento.create({
    data: {
      protocolo: generateProtocol(),
      publicTokenMotorista: generatePublicToken("MOT"),
      publicTokenFornecedor: generatePublicToken("FOR"),
      checkinToken: generatePublicToken("CHK"),
      fornecedor: p.fornecedor || "Fornecedor Externo",
      transportadora: p.transportadora || "Transportadora Externa",
      motorista: p.motorista || "Motorista Externo",
      telefoneMotorista: p.telefoneMotorista || "",
      placa: p.placa || "",
      doca: p.doca || "",
      janela: p.janela || "",
      dataAgendada: p.dataAgendada || new Date().toISOString().slice(0, 10),
      horaAgendada: p.horaAgendada || "08:00",
      quantidadeNotas: Number(p.quantidadeNotas || 0),
      quantidadeVolumes: Number(p.quantidadeVolumes || 0),
      status: "PENDENTE_APROVACAO",
      observacoes: p.observacoes || "",
      lgpdConsentAt: new Date()
    }
  });

  if (Array.isArray(p.notas)) {
    for (const nota of p.notas) {
      await prisma.notaFiscal.create({
        data: {
          agendamentoId: ag.id,
          numeroNf: nota.numeroNf || "",
          serie: nota.serie || "",
          chaveAcesso: nota.chaveAcesso || "",
          volumes: Number(nota.volumes || 0),
          peso: Number(nota.peso || 0),
          valorNf: Number(nota.valorNf || 0),
          observacao: nota.observacao || ""
        }
      });
    }
  }

  res.status(201).json({
    protocolo: ag.protocolo,
    status: ag.status,
    linkMotorista: `/ ?view=motorista&token=${encodeURIComponent(ag.publicTokenMotorista)}`,
    linkFornecedor: `/ ?view=fornecedor&token=${encodeURIComponent(ag.publicTokenFornecedor)}`
  });
});

router.get("/motorista/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({
    where: { publicTokenMotorista: req.params.token },
    include: { notasFiscais: true }
  });
  if (!item) return res.status(404).json({ message: "Token inválido." });

  res.json({
    protocolo: item.protocolo,
    motorista: item.motorista,
    telefoneMotorista: item.telefoneMotorista,
    placa: item.placa,
    dataAgendada: item.dataAgendada,
    horaAgendada: item.horaAgendada,
    status: item.status,
    transportadora: item.transportadora
  });
});

router.get("/fornecedor/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({
    where: { publicTokenFornecedor: req.params.token },
    include: { notasFiscais: true }
  });
  if (!item) return res.status(404).json({ message: "Token inválido." });
  res.json(item);
});

router.post("/fornecedor/:token/notas", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { publicTokenFornecedor: req.params.token } });
  if (!item) return res.status(404).json({ message: "Token inválido." });

  const payload = req.body || {};
  if (!payload.numeroNf && !payload.chaveAcesso) {
    return res.status(400).json({ message: "Informe o número ou a chave da NF." });
  }

  const nota = await prisma.notaFiscal.create({
    data: {
      agendamentoId: item.id,
      numeroNf: payload.numeroNf || "",
      serie: payload.serie || "",
      chaveAcesso: payload.chaveAcesso || "",
      volumes: Number(payload.volumes || 0),
      peso: Number(payload.peso || 0),
      valorNf: Number(payload.valorNf || 0),
      observacao: payload.observacao || ""
    }
  });

  res.status(201).json(nota);
});

router.post("/checkin/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });

  const updated = await prisma.agendamento.update({
    where: { id: item.id },
    data: { status: "CHEGOU", checkinEm: new Date() }
  });

  res.json({ ok: true, message: "Check-in validado com sucesso.", agendamento: updated });
});

export default router;
