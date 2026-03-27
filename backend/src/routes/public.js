import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();

function validateNf(data) {
  if (!data.numeroNf) {
    throw new Error("Número da NF é obrigatório");
  }
}

router.get("/disponibilidade", async (req, res) => {
  try {
    const { data } = req.query;

    if (!data) {
      return res.status(400).json({ message: "Data é obrigatória" });
    }

    const janelas = await prisma.janela.findMany({
      where: { ativo: true },
      include: {
        agendamentos: {
          where: { dataAgendada: new Date(data) }
        }
      }
    });

    const resultado = janelas.map(j => {
      const ocupados = j.agendamentos.length;
      const disponivel = j.capacidade - ocupados;

      return {
        id: j.id,
        horarioInicio: j.horarioInicio,
        horarioFim: j.horarioFim,
        capacidade: j.capacidade,
        ocupados,
        disponivel
      };
    });

    res.json(resultado);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/agendamento", async (req, res) => {
  try {
    const {
      transportadora,
      fornecedor,
      motorista,
      placa,
      dataAgendada,
      janelaId
    } = req.body;

    if (!dataAgendada || !janelaId) {
      return res.status(400).json({ message: "Data e janela são obrigatórias" });
    }

    const novo = await prisma.agendamento.create({
      data: {
        transportadora,
        fornecedor,
        motorista,
        placa,
        dataAgendada: new Date(dataAgendada),
        janelaId: Number(janelaId),
        status: "PENDENTE",
        docaId: null
      }
    });

    res.status(201).json(novo);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get("/fornecedor/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({
    where: { publicTokenFornecedor: req.params.token },
    include: {
      notasFiscais: true,
      doca: true,
      janela: true
    }
  });

  if (!item) {
    return res.status(404).json({ message: "Token inválido." });
  }

  res.json(item);
});

router.post("/fornecedor/:token/notas", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenFornecedor: req.params.token }
    });

    if (!item) {
      return res.status(404).json({ message: "Token inválido." });
    }

    validateNf(req.body || {});

    const nf = await prisma.notaFiscal.create({
      data: {
        agendamentoId: item.id,
        numeroNf: req.body.numeroNf || "",
        serie: req.body.serie || "",
        chaveAcesso: req.body.chaveAcesso || "",
        volumes: Number(req.body.volumes || 0),
        peso: Number(req.body.peso || 0),
        valorNf: Number(req.body.valorNf || 0),
        observacao: req.body.observacao || ""
      }
    });

    res.status(201).json(nf);
  } catch (err) {
    res.status(400).json({ message: err.message });
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
      return res.status(400).json({
        message: "Check-in só permitido para agendamentos aprovados"
      });
    }

    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: {
        status: "CHEGOU",
        checkinEm: new Date()
      }
    });

    res.json({
      ok: true,
      message: "Check-in realizado com sucesso",
      agendamento: updated
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
