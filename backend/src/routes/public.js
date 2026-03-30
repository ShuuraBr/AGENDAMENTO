import express from "express";
import { prisma } from "../utils/prisma.js";
import {
  validateAgendamentoPayload,
  validateNf,
  normalizeChaveAcesso
} from "../utils/validators.js";
import {
  assertJanelaDocaDisponivel,
  generateProtocol,
  generatePublicToken,
  getOrCreateDocaPadrao,
  parseJanelaCodigo
} from "../services/agendamentoService.js";

const router = express.Router();

function validateNfBatch(notas = []) {
  for (const nota of notas) {
    validateNf(nota || {});
  }
}

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = req.body || {};
    const janelaId = Number(payload.janelaId);

    if (!Number.isInteger(janelaId) || janelaId <= 0) {
      return res.status(400).json({ message: "Janela inválida." });
    }

    const janela = await prisma.janela.findUnique({ where: { id: janelaId } });
    if (!janela) {
      return res.status(404).json({ message: "Janela não encontrada." });
    }

    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const doca = await getOrCreateDocaPadrao();

    const notasNormalizadas = Array.isArray(payload.notas)
      ? payload.notas.map((nota) => ({
          numeroNf: String(nota?.numeroNf || "").trim(),
          serie: String(nota?.serie || "").trim(),
          chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
          volumes: Number(nota?.volumes || 0),
          peso: Number(nota?.peso || 0),
          valorNf: Number(nota?.valorNf || 0),
          observacao: String(nota?.observacao || "").trim()
        }))
      : [];

    const agendamentoPayload = {
      fornecedor: String(payload.fornecedor || "").trim(),
      transportadora: String(payload.transportadora || "").trim(),
      motorista: String(payload.motorista || "").trim(),
      telefoneMotorista: String(payload.telefoneMotorista || "").trim(),
      emailMotorista: String(payload.emailMotorista || "").trim(),
      emailTransportadora: String(payload.emailTransportadora || "").trim(),
      placa: String(payload.placa || "").trim().toUpperCase(),
      dataAgendada: String(payload.dataAgendada || "").trim(),
      horaAgendada,
      janelaId,
      docaId: doca.id,
      quantidadeNotas: Number(payload.quantidadeNotas || 0),
      quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
      observacoes: String(payload.observacoes || "").trim(),
      lgpdConsent: Boolean(payload.lgpdConsent)
    };

    validateAgendamentoPayload(agendamentoPayload, true);
    validateNfBatch(notasNormalizadas);

    await assertJanelaDocaDisponivel({
      docaId: doca.id,
      janelaId,
      dataAgendada: agendamentoPayload.dataAgendada
    });

    const created = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken("MOT"),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: agendamentoPayload.fornecedor,
        transportadora: agendamentoPayload.transportadora,
        motorista: agendamentoPayload.motorista,
        telefoneMotorista: agendamentoPayload.telefoneMotorista,
        emailMotorista: agendamentoPayload.emailMotorista,
        emailTransportadora: agendamentoPayload.emailTransportadora,
        placa: agendamentoPayload.placa,
        docaId: doca.id,
        janelaId,
        dataAgendada: agendamentoPayload.dataAgendada,
        horaAgendada,
        quantidadeNotas: agendamentoPayload.quantidadeNotas,
        quantidadeVolumes: agendamentoPayload.quantidadeVolumes,
        status: "PENDENTE_APROVACAO",
        observacoes: agendamentoPayload.observacoes,
        lgpdConsentAt: new Date()
      }
    });

    if (notasNormalizadas.length) {
      await prisma.notaFiscal.createMany({
        data: notasNormalizadas.map((nota) => ({
          agendamentoId: created.id,
          numeroNf: nota.numeroNf,
          serie: nota.serie,
          chaveAcesso: nota.chaveAcesso,
          volumes: nota.volumes,
          peso: nota.peso,
          valorNf: nota.valorNf,
          observacao: nota.observacao
        }))
      });
    }

    const base = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;

    res.status(201).json({
      ok: true,
      id: created.id,
      protocolo: created.protocolo,
      horaAgendada,
      doca: doca.codigo,
      linkMotorista: `${base}/?view=motorista&token=${encodeURIComponent(created.publicTokenMotorista)}`,
      linkFornecedor: `${base}/?view=fornecedor&token=${encodeURIComponent(created.publicTokenFornecedor)}`
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
