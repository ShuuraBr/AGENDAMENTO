import { Router } from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf } from "../utils/validators.js";


const router = Router();

async function getOrCreateDocaPendente() {
  const existing = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" } });
  if (existing) return existing;
  return prisma.doca.create({
    data: {
      codigo: "A DEFINIR",
      descricao: "Doca definida pelo operador do recebimento"
    }
  });
}

async function getDisponibilidade(dataAgendada) {
  const [docas, janelas, agendamentos] = await Promise.all([
    prisma.doca.findMany({ where: { codigo: { not: "A DEFINIR" } }, orderBy: { codigo: "asc" } }),
    prisma.janela.findMany({ orderBy: { codigo: "asc" } }),
    prisma.agendamento.findMany({
      where: {
        dataAgendada: String(dataAgendada),
        status: { in: ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"] }
      },
      select: { janelaId: true }
    })
  ]);

  const capacidadeTotal = Math.max(docas.length, 1);
  return janelas.map((janela) => {
    const ocupados = agendamentos.filter((item) => item.janelaId === janela.id).length;
    return {
      janelaId: janela.id,
      codigo: janela.codigo,
      hora: janela.codigo,
      descricao: janela.descricao || "",
      ocupados,
      capacidade: capacidadeTotal,
      disponivel: ocupados < capacidadeTotal
    };
  });
}

router.get("/disponibilidade", async (req, res) => {
  try {
    const inicio = new Date();
    const dias = Math.min(Math.max(Number(req.query?.dias || 14), 1), 31);
    const agenda = [];

    for (let i = 0; i < dias; i += 1) {
      const data = new Date(inicio);
      data.setDate(inicio.getDate() + i);
      const yyyy = data.getFullYear();
      const mm = String(data.getMonth() + 1).padStart(2, "0");
      const dd = String(data.getDate()).padStart(2, "0");
      const dataAgendada = `${yyyy}-${mm}-${dd}`;
      const slots = await getDisponibilidade(dataAgendada);
      agenda.push({
        data: dataAgendada,
        disponivel: slots.some((slot) => slot.disponivel),
        horarios: slots
      });
    }

    res.json({ agenda });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.post("/solicitacao", async (req, res) => {
  try {
    const p = req.body || {};
    validateAgendamentoPayload(p, true);
    const docaPendente = await getOrCreateDocaPendente();
    const slots = await getDisponibilidade(p.dataAgendada);
    const slot = slots.find((item) => item.janelaId === Number(p.janelaId));
    if (!slot) throw new Error("Janela não encontrada para a data informada.");
    if (!slot.disponivel) throw new Error("Horário indisponível para a data selecionada.");

    const notas = Array.isArray(p.notas)
      ? p.notas
          .map((nota) => ({
            numeroNf: String(nota?.numeroNf || "").trim(),
            serie: String(nota?.serie || "").trim(),
            chaveAcesso: String(nota?.chaveAcesso || "").trim(),
            volumes: Number(nota?.volumes || 0),
            peso: Number(nota?.peso || 0),
            valorNf: Number(nota?.valorNf || 0),
            observacao: String(nota?.observacao || "").trim()
          }))
          .filter((nota) => nota.numeroNf || nota.chaveAcesso)
      : [];

    for (const nota of notas) validateNf(nota);

    const ag = await prisma.$transaction(async (tx) => {
      const created = await tx.agendamento.create({
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
          docaId: Number(docaPendente.id),
          janelaId: Number(p.janelaId),
          dataAgendada: p.dataAgendada,
          horaAgendada: p.horaAgendada,
          quantidadeNotas: notas.length,
          quantidadeVolumes: Number(p.quantidadeVolumes || 0),
          status: "PENDENTE_APROVACAO",
          observacoes: p.observacoes || "",
          lgpdConsentAt: new Date()
        }
      });

      if (notas.length) {
        await tx.notaFiscal.createMany({
          data: notas.map((nota) => ({
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

      return created;
    });

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
    include: { doca: true, janela: true, notasFiscais: true }
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
    transportadora: item.transportadora,
    doca: item.doca?.codigo || null,
    janela: item.janela?.codigo || null
  });
});

router.get("/fornecedor/:token", async (req, res) => {
  const item = await prisma.agendamento.findUnique({
    where: { publicTokenFornecedor: req.params.token },
    include: { notasFiscais: true, doca: true, janela: true }
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

export default router;
