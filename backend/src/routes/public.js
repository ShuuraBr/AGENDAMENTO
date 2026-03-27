import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf } from "../utils/validators.js";

const router = Router();

router.post("/solicitacao", async (req, res) => {
  try {
    const p = req.body || {};
    validateAgendamentoPayload(p, true);

    const ag = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken("MOT"),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: p.fornecedor,
        transportadora: p.transportadora,
        motorista: p.motorista,
        telefoneMotorista: p.telefoneMotorista || "",
        emailMotorista: p.emailMotorista || "",
        emailTransportadora: p.emailTransportadora || "",
        placa: p.placa,
        doca: p.doca || "",
        janela: p.janela || "",
        dataAgendada: p.dataAgendada,
        horaAgendada: p.horaAgendada,
        quantidadeNotas: Number(p.quantidadeNotas || 0),
        quantidadeVolumes: Number(p.quantidadeVolumes || 0),
        status: "PENDENTE_APROVACAO",
        observacoes: p.observacoes || "",
        lgpdConsentAt: new Date()
      }
    });

    if (Array.isArray(p.notas)) {
      for (const nota of p.notas) {
        validateNf(nota);
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
      linkMotorista: `/?view=motorista&token=${encodeURIComponent(ag.publicTokenMotorista)}`,
      linkFornecedor: `/?view=fornecedor&token=${encodeURIComponent(ag.publicTokenFornecedor)}`
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
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
  try {
    const item = await prisma.agendamento.findUnique({ where: { publicTokenFornecedor: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token inválido." });
    validateNf(req.body || {});
    res.status(201).json(await prisma.notaFiscal.create({
      data: {
        agendamentoId: item.id,
        numeroNf: req.body?.numeroNf || "",
        serie: req.body?.serie || "",
        chaveAcesso: req.body?.chaveAcesso || "",
        volumes: Number(req.body?.volumes || 0),
        peso: Number(req.body?.peso || 0),
        valorNf: Number(req.body?.valorNf || 0),
        observacao: req.body?.observacao || ""
      }
    }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/checkin/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
  if (!item) return res.status(404).json({ message: "Token de check-in inválido." });
  if (!["APROVADO", "CHEGOU"].includes(item.status)) {
    return res.status(400).json({ message: "Check-in só é permitido para agendamento aprovado." });
  }

  const updated = await prisma.agendamento.update({
    where: { id: item.id },
    data: { status: "CHEGOU", checkinEm: new Date() }
  });

  res.json({ ok: true, message: "Check-in validado com sucesso.", agendamento: updated });
});

export default router;
