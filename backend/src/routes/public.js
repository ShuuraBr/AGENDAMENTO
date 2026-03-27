import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";

const router = Router();

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(base, amount) {
  const dt = new Date(base);
  dt.setDate(dt.getDate() + amount);
  return dt;
}

async function buildAgenda(days = 21) {
  const totalDias = Math.max(1, Math.min(Number(days) || 21, 60));
  const janelas = await prisma.janela.findMany({ orderBy: { id: "asc" } });
  const agenda = [];

  for (let i = 0; i < totalDias; i += 1) {
    const data = toDateString(addDays(new Date(), i));
    const agendamentos = await prisma.agendamento.findMany({
      where: { dataAgendada: data },
      select: { janelaId: true, status: true }
    });

    const ocupacao = new Map();
    for (const item of agendamentos) {
      const atual = ocupacao.get(item.janelaId) || 0;
      ocupacao.set(item.janelaId, atual + 1);
    }

    const horarios = janelas.map((janela) => {
      const hora = String(janela.codigo || "").match(/(\d{2}:\d{2})/)?.[1] || janela.codigo || "";
      const ocupados = ocupacao.get(janela.id) || 0;
      const capacidade = 1;
      return {
        janelaId: janela.id,
        hora,
        descricao: janela.descricao || janela.codigo || "Janela disponível",
        capacidade,
        ocupados,
        disponivel: ocupados < capacidade
      };
    });

    agenda.push({
      data,
      disponivel: horarios.some((slot) => slot.disponivel),
      horarios
    });
  }

  return agenda;
}

router.get("/disponibilidade", async (req, res) => {
  try {
    const agenda = await buildAgenda(req.query?.dias || 21);
    res.json({ agenda });
  } catch (err) {
    res.status(500).json({ message: err.message || "Falha ao carregar disponibilidade." });
  }
});

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = req.body || {};
    const dataAgendada = String(payload.dataAgendada || "").trim();
    const horaAgendada = String(payload.horaAgendada || "").trim();
    const janelaId = Number(payload.janelaId || 0);
    const lgpdConsent = !!payload.lgpdConsent;

    if (!dataAgendada || !horaAgendada || !janelaId) {
      return res.status(400).json({ message: "Data, horário e janela são obrigatórios." });
    }
    if (!lgpdConsent) {
      return res.status(400).json({ message: "É obrigatório aceitar o consentimento LGPD." });
    }

    const [janela, doca] = await Promise.all([
      prisma.janela.findUnique({ where: { id: janelaId } }),
      prisma.doca.findFirst({ orderBy: { id: "asc" } })
    ]);

    if (!janela) {
      return res.status(400).json({ message: "Janela inválida." });
    }
    if (!doca) {
      return res.status(400).json({ message: "Nenhuma doca cadastrada para receber a solicitação." });
    }

    const jaExiste = await prisma.agendamento.count({
      where: { dataAgendada, janelaId, status: { not: "CANCELADO" } }
    });

    if (jaExiste >= 1) {
      return res.status(400).json({ message: "Esta janela não está mais disponível para a data selecionada." });
    }

    const item = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
        publicTokenMotorista: generatePublicToken("MOT"),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: String(payload.fornecedor || "").trim() || "Fornecedor não informado",
        transportadora: String(payload.transportadora || "").trim() || "Transportadora não informada",
        motorista: String(payload.motorista || "").trim() || "Motorista não informado",
        telefoneMotorista: String(payload.telefoneMotorista || "").trim(),
        emailMotorista: String(payload.emailMotorista || "").trim(),
        emailTransportadora: String(payload.emailTransportadora || "").trim(),
        placa: String(payload.placa || "").trim().toUpperCase(),
        docaId: doca.id,
        janelaId,
        dataAgendada,
        horaAgendada,
        quantidadeNotas: Number(payload.quantidadeNotas || 0),
        quantidadeVolumes: Number(payload.quantidadeVolumes || 0),
        status: "PENDENTE_APROVACAO",
        observacoes: String(payload.observacoes || "").trim(),
        lgpdConsentAt: new Date()
      }
    });

    const notas = Array.isArray(payload.notas) ? payload.notas : [];
    for (const nota of notas) {
      if (!nota?.numeroNf && !nota?.chaveAcesso) continue;
      await prisma.notaFiscal.create({
        data: {
          agendamentoId: item.id,
          numeroNf: String(nota.numeroNf || "").trim(),
          serie: String(nota.serie || "").trim(),
          chaveAcesso: String(nota.chaveAcesso || "").trim(),
          volumes: Number(nota.volumes || 0),
          peso: Number(nota.peso || 0),
          valorNf: Number(nota.valorNf || 0),
          observacao: String(nota.observacao || "").trim()
        }
      });
    }

    const base = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;
    const linkMotorista = `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`;

    res.status(201).json({
      protocolo: item.protocolo,
      status: item.status,
      linkMotorista
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Falha ao registrar solicitação." });
  }
});

router.get("/motorista/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenMotorista: req.params.token },
      include: { notasFiscais: true, doca: true, janela: true }
    });

    if (!item) {
      return res.status(404).json({ message: "Token do motorista inválido." });
    }

    res.json({
      protocolo: item.protocolo,
      status: item.status,
      dataAgendada: item.dataAgendada,
      horaAgendada: item.horaAgendada,
      doca: item.doca?.codigo || "-",
      janela: item.janela?.codigo || "-",
      fornecedor: item.fornecedor,
      transportadora: item.transportadora,
      motorista: item.motorista,
      placa: item.placa,
      quantidadeNotas: item.quantidadeNotas,
      quantidadeVolumes: item.quantidadeVolumes,
      notasFiscais: item.notasFiscais
    });
  } catch (err) {
    res.status(500).json({ message: err.message || "Falha ao consultar motorista." });
  }
});

router.get("/fornecedor/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenFornecedor: req.params.token },
      include: { notasFiscais: true, doca: true, janela: true }
    });

    if (!item) {
      return res.status(404).json({ message: "Token do fornecedor inválido." });
    }

    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message || "Falha ao consultar fornecedor." });
  }
});

router.post("/checkin/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { checkinToken: req.params.token }
    });

    if (!item) {
      return res.status(404).json({ message: "Token de check-in inválido." });
    }

    if (!["APROVADO", "CHEGOU"].includes(item.status)) {
      return res.status(400).json({ message: "Check-in só é permitido para agendamento aprovado." });
    }

    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: {
        status: "CHEGOU",
        checkinEm: new Date()
      }
    });

    res.json({ ok: true, message: "Check-in realizado com sucesso.", agendamento: updated });
  } catch (err) {
    res.status(500).json({ message: err.message || "Falha ao validar check-in." });
  }
});

export default router;
