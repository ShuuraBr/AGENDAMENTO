import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { calcularAprovacaoAutomatica, ocuparJanela } from "../agendamentos/rules.js";

const router = Router();

router.post("/solicitacao", async (req, res) => {
  const payload = req.body || {};
  const avaliacao = await calcularAprovacaoAutomatica(payload);
  const status = avaliacao.aprovadoAutomaticamente ? "APROVADO" : "PENDENTE_APROVACAO";

  const item = await prisma.agendamento.create({
    data: {
      protocolo: `AGD-${Date.now()}`,
      unidadeId: Number(payload.unidadeId),
      docaId: payload.docaId ? Number(payload.docaId) : null,
      janelaId: payload.janelaId ? Number(payload.janelaId) : null,
      fornecedorId: payload.fornecedorId ? Number(payload.fornecedorId) : null,
      transportadoraId: payload.transportadoraId ? Number(payload.transportadoraId) : null,
      motoristaId: payload.motoristaId ? Number(payload.motoristaId) : null,
      veiculoId: payload.veiculoId ? Number(payload.veiculoId) : null,
      origemSolicitacao: payload.origemSolicitacao || "TRANSPORTADORA",
      status,
      dataAgendada: new Date(payload.dataAgendada),
      horaAgendada: payload.horaAgendada,
      quantidadeNotas: Number(payload.quantidadeNotas || 0),
      quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
      pesoTotalKg: payload.pesoTotalKg ? String(payload.pesoTotalKg) : null,
      observacoes: payload.observacoes || null
    }
  });

  if (avaliacao.aprovadoAutomaticamente && payload.janelaId) {
    await ocuparJanela(payload.janelaId);
  }

  res.status(201).json({ protocolo: item.protocolo, status: item.status, avaliacao });
});

router.get("/motorista/:protocolo", async (req, res) => {
  const item = await prisma.agendamento.findUnique({
    where: { protocolo: req.params.protocolo },
    include: {
      unidade: true,
      doca: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true
    }
  });

  if (!item) return res.status(404).json({ message: "Protocolo não encontrado." });

  res.json({
    protocolo: item.protocolo,
    status: item.status,
    dataAgendada: item.dataAgendada,
    horaAgendada: item.horaAgendada,
    unidade: item.unidade?.nome || "-",
    doca: item.doca?.codigo || "-",
    transportadora: item.transportadora?.razaoSocial || "-",
    motorista: item.motorista?.nome || "-",
    placa: item.veiculo?.placaCavalo || "-"
  });
});

export default router;
