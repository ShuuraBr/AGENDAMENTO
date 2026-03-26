import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { prisma } from "../../config/prisma.js";
import { authRequired, requireProfiles } from "../../middlewares/auth.js";
import { calcularAprovacaoAutomatica, ocuparJanela, liberarJanela } from "./rules.js";
import { generateVoucherPdf } from "../../services/voucher.js";
import { sendEmail } from "../../services/email.js";
import { sendWhatsApp } from "../../services/whatsapp.js";

const router = Router();

const uploadDir = path.resolve("uploads", "documentos");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "-")}`)
});
const upload = multer({ storage });

router.use(authRequired);

async function getAgendamentoCompleto(id) {
  return prisma.agendamento.findUnique({
    where: { id: Number(id) },
    include: {
      unidade: true,
      doca: true,
      janela: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true
    }
  });
}

router.get("/", async (_req, res) => {
  const items = await prisma.agendamento.findMany({
    include: {
      unidade: true,
      doca: true,
      janela: true,
      fornecedor: true,
      transportadora: true,
      motorista: true,
      veiculo: true,
      documentos: true
    },
    orderBy: [{ dataAgendada: "desc" }, { horaAgendada: "desc" }]
  });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const item = await getAgendamentoCompleto(req.params.id);
  if (!item) return res.status(404).json({ message: "Agendamento não encontrado." });
  res.json(item);
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

  if (avaliacao.aprovadoAutomaticamente && payload.janelaId) {
    await ocuparJanela(payload.janelaId);
  }

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
  const updated = await prisma.agendamento.update({
    where: { id: Number(req.params.id) },
    data: {
      status: "REPROVADO",
      observacoesInternas: req.body?.motivo || "Reprovado pelo operador."
    }
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

  const avaliacao = await calcularAprovacaoAutomatica({
    unidadeId: current.unidadeId,
    janelaId: novaJanelaId
  });

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
  const current = await prisma.agendamento.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ message: "Agendamento não encontrado." });

  await liberarJanela(current.janelaId);

  const updated = await prisma.agendamento.update({
    where: { id },
    data: {
      status: "CANCELADO",
      canceladoPorUsuarioId: Number(req.user.sub),
      canceladoEm: new Date(),
      motivoCancelamento: req.body?.motivo || "Cancelado manualmente."
    }
  });

  res.json(updated);
});

router.post("/:id/documentos", upload.single("arquivo"), async (req, res) => {
  const agendamentoId = Number(req.params.id);
  const ag = await prisma.agendamento.findUnique({ where: { id: agendamentoId } });
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado." });

  const doc = await prisma.documento.create({
    data: {
      agendamentoId,
      tipoDocumento: req.body?.tipoDocumento || "ANEXO",
      nomeArquivo: req.file.originalname,
      urlArquivo: req.file.path.replace(/\\/g, "/"),
      mimeType: req.file.mimetype,
      tamanhoBytes: req.file.size
    }
  });

  res.status(201).json(doc);
});

router.get("/:id/voucher", async (req, res) => {
  const ag = await getAgendamentoCompleto(req.params.id);
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });

  const filePath = await generateVoucherPdf(ag);
  res.download(filePath);
});

router.post("/:id/enviar-confirmacao", async (req, res) => {
  const ag = await getAgendamentoCompleto(req.params.id);
  if (!ag) return res.status(404).json({ message: "Agendamento não encontrado." });

  const destinosEmail = [
    ag.fornecedor?.email,
    ag.transportadora?.email,
    ag.motorista?.email
  ].filter(Boolean);

  const text = `Protocolo ${ag.protocolo} confirmado para ${new Date(ag.dataAgendada).toLocaleDateString("pt-BR")} às ${ag.horaAgendada}.`;
  const results = [];

  for (const to of destinosEmail) {
    const result = await sendEmail({
      to,
      subject: `Confirmação de agendamento ${ag.protocolo}`,
      text,
      html: `<p>${text}</p>`
    });
    results.push({ canal: "EMAIL", to, ...result });
  }

  const whatsappTargets = [
    ag.fornecedor?.whatsapp,
    ag.transportadora?.whatsapp,
    ag.motorista?.whatsapp
  ].filter(Boolean);

  for (const to of whatsappTargets) {
    const result = await sendWhatsApp({ to, message: text });
    results.push({ canal: "WHATSAPP", to, ...result });
  }

  res.json({ protocolo: ag.protocolo, results });
});

export default router;
