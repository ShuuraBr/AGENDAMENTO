import express from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from "../utils/db-fallback.js";

const router = express.Router();

const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function validateNfBatch(notas = []) {
  for (const nota of notas) {
    validateNf(nota || {});
  }
}

function parseJanelaCodigo(codigo = "") {
  const match = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  if (!match) {
    return { horaInicio: String(codigo).trim() || "00:00", horaFim: "", codigo: String(codigo) };
  }
  return {
    horaInicio: match[1],
    horaFim: match[2] || "",
    codigo: String(codigo)
  };
}

function formatDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

async function getOrCreateDocaPadrao() {
  const existing = await prisma.doca.findFirst({
    where: { codigo: "A DEFINIR" },
    orderBy: { id: "asc" }
  });

  if (existing) return existing;

  const first = await prisma.doca.findFirst({ orderBy: { id: "asc" } });
  if (first) return first;

  return prisma.doca.create({
    data: {
      codigo: "A DEFINIR",
      descricao: "Doca definida pelo operador no recebimento"
    }
  });
}

async function loadJanelasDocas() {
  try {
    const [janelas, docas] = await Promise.all([
      prisma.janela.findMany({ orderBy: { codigo: "asc" } }),
      prisma.doca.findMany({ orderBy: { codigo: "asc" } })
    ]);
    return { janelas, docas };
  } catch (ormError) {
    console.error("Prisma ORM falhou em disponibilidade. Tentando fallback SQL:", ormError?.message || ormError);
    return fetchJanelasDocas();
  }
}


async function resolveJanela(rawJanelaId) {
  const janelaId = Number(rawJanelaId);
  if (!Number.isInteger(janelaId) || janelaId <= 0) {
    const error = new Error("Janela inválida.");
    error.statusCode = 400;
    throw error;
  }

  const janela = await prisma.janela.findFirst({ where: { id: janelaId } });
  if (!janela) {
    const error = new Error("Janela não encontrada.");
    error.statusCode = 404;
    throw error;
  }

  return janela;
}

async function loadAgendamentos(datas) {
  try {
    return await prisma.agendamento.findMany({
      where: {
        dataAgendada: { in: datas },
        status: { in: ACTIVE_STATUSES }
      },
      select: {
        dataAgendada: true,
        janelaId: true,
        protocolo: true,
        status: true,
        motorista: true,
        placa: true,
        fornecedor: true,
        transportadora: true,
        horaAgendada: true
      }
    });
  } catch (ormError) {
    console.error("Prisma ORM falhou ao carregar agendamentos. Tentando fallback SQL:", ormError?.message || ormError);
    return fetchAgendamentosByDatasStatuses(datas, ACTIVE_STATUSES);
  }
}

async function buildAgenda({ dias = 21 } = {}) {
  const { janelas, docas } = await loadJanelasDocas();

  if (!janelas.length) {
    return {
      agenda: [],
      meta: {
        dias,
        capacidadePorHorario: 0,
        totalDocas: docas.length,
        motivo: "Nenhuma janela cadastrada"
      }
    };
  }

  const capacidadePorHorario = Math.max(docas.length, 1);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const datas = Array.from({ length: dias }, (_, index) => {
    const date = new Date(hoje);
    date.setDate(hoje.getDate() + index);
    return formatDate(date);
  });

  const agendamentos = await loadAgendamentos(datas);

  const occupancy = new Map();
  for (const item of agendamentos) {
    const key = `${item.dataAgendada}::${item.janelaId}`;
    occupancy.set(key, (occupancy.get(key) || 0) + 1);
  }

  const agenda = datas.map((data) => {
    const horarios = janelas.map((janela) => {
      const parsed = parseJanelaCodigo(janela.codigo);
      const key = `${data}::${janela.id}`;
      const ocupados = occupancy.get(key) || 0;
      const disponivel = Math.max(capacidadePorHorario - ocupados, 0);
      return {
        janelaId: janela.id,
        codigo: janela.codigo,
        descricao: janela.descricao || "",
        hora: parsed.horaInicio,
        horaFim: parsed.horaFim,
        capacidade: capacidadePorHorario,
        ocupados,
        disponivel,
        ativo: disponivel > 0
      };
    });

    return {
      data,
      disponivel: horarios.some((slot) => slot.disponivel > 0),
      horarios
    };
  });

  return {
    agenda,
    meta: {
      dias,
      capacidadePorHorario,
      totalDocas: docas.length,
      totalJanelas: janelas.length
    }
  };
}

router.get("/disponibilidade", async (req, res) => {
  try {
    const diasRaw = Number(req.query?.dias || 21);
    const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(diasRaw, 1), 60) : 21;
    const payload = await buildAgenda({ dias });
    res.json(payload);
  } catch (err) {
    console.error("Erro em /public/disponibilidade:", err);
    res.status(err?.statusCode || 500).json({ message: err?.message || "Falha ao consultar disponibilidade." });
  }
});

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    if (payload.janelaId == null || payload.janelaId === "") {
      return res.status(400).json({ message: "Janela é obrigatória." });
    }

    const janela = await resolveJanela(payload.janelaId);
    const janelaId = janela.id;

    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const doca = await getOrCreateDocaPadrao();

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
    validateNfBatch(Array.isArray(payload.notas) ? payload.notas : []);

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

    const notas = Array.isArray(payload.notas) ? payload.notas : [];
    if (notas.length) {
      await prisma.notaFiscal.createMany({
        data: notas.map((nota) => ({
          agendamentoId: created.id,
          numeroNf: String(nota.numeroNf || "").trim(),
          serie: String(nota.serie || "").trim(),
          chaveAcesso: String(nota.chaveAcesso || "").trim(),
          volumes: Number(nota.volumes || 0),
          peso: Number(nota.peso || 0),
          valorNf: Number(nota.valorNf || 0),
          observacao: String(nota.observacao || "").trim()
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

router.get("/motorista/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenMotorista: req.params.token },
      include: {
        notasFiscais: true,
        doca: true,
        janela: true,
        documentos: true
      }
    });

    if (!item) {
      return res.status(404).json({ message: "Token inválido." });
    }

    res.json({
      ...item,
      semaforo: trafficColor(item.status)
    });
  } catch (err) {
    console.error("Erro em /public/disponibilidade:", err);
    res.status(err?.statusCode || 500).json({ message: err?.message || "Falha ao consultar disponibilidade." });
  }
});

router.get("/fornecedor/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenFornecedor: req.params.token },
      include: {
        notasFiscais: true,
        doca: true,
        janela: true,
        documentos: true
      }
    });

    if (!item) {
      return res.status(404).json({ message: "Token inválido." });
    }

    res.json(item);
  } catch (err) {
    console.error("Erro em /public/disponibilidade:", err);
    res.status(err?.statusCode || 500).json({ message: err?.message || "Falha ao consultar disponibilidade." });
  }
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
    console.error("Erro em /public/disponibilidade:", err);
    res.status(err?.statusCode || 500).json({ message: err?.message || "Falha ao consultar disponibilidade." });
  }
});

export default router;
