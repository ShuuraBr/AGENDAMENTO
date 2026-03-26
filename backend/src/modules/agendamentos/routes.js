import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authRequired, requireProfiles } from "../../middlewares/auth.js";
import { calcularAprovacaoAutomatica, ocuparJanela, liberarJanela } from "./rules.js";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const data = await prisma.agendamento.findMany({
    include: { unidade: true, doca: true, janela: true, fornecedor: true, transportadora: true, motorista: true, veiculo: true },
    orderBy: [{ dataAgendada: "desc" }, { horaAgendada: "desc" }]
  });
  res.json(data);
});

router.post("/", async (req, res) => {
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
      origemSolicitacao: payload.origemSolicitacao || "INTERNO",
      status,
      dataAgendada: new Date(payload.dataAgendada),
      horaAgendada: payload.horaAgendada,
      quantidadeNotas: Number(payload.quantidadeNotas || 0),
      quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
      pesoTotalKg: payload.pesoTotalKg ? String(payload.pesoTotalKg) : null,
      observacoes: payload.observacoes || null,
      criadoPorUsuarioId: Number(req.user.sub),
      aprovadoPorUsuarioId: avaliacao.aprovadoAutomaticamente ? Number(req.user.sub) : null,
      aprovadoEm: avaliacao.aprovadoAutomaticamente ? new Date() : null
    }
  });

  if (avaliacao.aprovadoAutomaticamente && payload.janelaId) await ocuparJanela(Number(payload.janelaId));
  res.status(201).json({ ...item, avaliacao });
});

router.post("/:id/aprovar", requireProfiles("ADMIN", "GESTOR_LOGISTICO", "OPERADOR_RECEBIMENTO"), async (req, res) => {
  const id = Number(req.params.id);
  const ag = await prisma.agendamento.findUnique({ where: { id } });
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (ag.status === "APROVADO") return res.status(400).json({ message: "Agendamento já aprovado." });

  const updated = await prisma.agendamento.update({
    where: { id },
    data: { status: "APROVADO", aprovadoPorUsuarioId: Number(req.user.sub), aprovadoEm: new Date() }
  });
  if (ag.janelaId) await ocuparJanela(ag.janelaId);
  res.json(updated);
});

router.post("/:id/reprovar", requireProfiles("ADMIN", "GESTOR_LOGISTICO", "OPERADOR_RECEBIMENTO"), async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body || {};
  const updated = await prisma.agendamento.update({
    where: { id },
    data: { status: "REPROVADO", observacoesInternas: motivo || "Reprovado pelo operador." }
  });
  res.json(updated);
});

router.post("/:id/reagendar", requireProfiles("ADMIN", "GESTOR_LOGISTICO", "OPERADOR_RECEBIMENTO"), async (req, res) => {
  const id = Number(req.params.id);
  const { janelaId, docaId, dataAgendada, horaAgendada, motivo } = req.body || {};
  const current = await prisma.agendamento.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ message: "Agendamento não encontrado." });

  await liberarJanela(current.janelaId);
  const novaJanelaId = janelaId ? Number(janelaId) : current.janelaId;
  const avaliacao = await calcularAprovacaoAutomatica({ unidadeId: current.unidadeId, janelaId: novaJanelaId });

  const updated = await prisma.agendamento.update({
    where: { id },
    data: {
      janelaId: novaJanelaId,
      docaId: docaId ? Number(docaId) : current.docaId,
      dataAgendada: dataAgendada ? new Date(dataAgendada) : current.dataAgendada,
      horaAgendada: horaAgendada || current.horaAgendada,
      status: avaliacao.aprovadoAutomaticamente ? "APROVADO" : "PENDENTE_APROVACAO",
      observacoesInternas: motivo || "Agendamento reagendado."
    }
  });

  if (updated.janelaId && avaliacao.aprovadoAutomaticamente) await ocuparJanela(updated.janelaId);
  res.json({ ...updated, avaliacao });
});

router.post("/:id/cancelar", requireProfiles("ADMIN", "GESTOR_LOGISTICO", "OPERADOR_RECEBIMENTO"), async (req, res) => {
  const id = Number(req.params.id);
  const { motivo } = req.body || {};
  const current = await prisma.agendamento.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ message: "Agendamento não encontrado." });

  await liberarJanela(current.janelaId);
  const updated = await prisma.agendamento.update({
    where: { id },
    data: {
      status: "CANCELADO",
      canceladoPorUsuarioId: Number(req.user.sub),
      canceladoEm: new Date(),
      motivoCancelamento: motivo || "Cancelado manualmente."
    }
  });
  res.json(updated);
});

export default router;
