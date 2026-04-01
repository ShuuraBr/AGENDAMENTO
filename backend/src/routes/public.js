import express from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken, generateCpfBasedMotoristaToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf, normalizeChaveAcesso, normalizeCpf } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from "../utils/db-fallback.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function calculateNotasTotals(notas = []) {
  return notas.reduce((acc, nota) => {
    acc.quantidadeNotas += 1;
    acc.quantidadeVolumes += Number(nota?.volumes || 0);
    acc.pesoTotal += Number(nota?.peso || 0);
    acc.valorTotal += Number(nota?.valorNf || 0);
    return acc;
  }, { quantidadeNotas: 0, quantidadeVolumes: 0, pesoTotal: 0, valorTotal: 0 });
}

function validateNfBatch(notas = []) {
  for (const nota of notas) validateNf(nota || {});
}

function parseJanelaCodigo(codigo = "") {
  const match = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  if (!match) return { horaInicio: String(codigo).trim() || "00:00", horaFim: "", codigo: String(codigo) };
  return { horaInicio: match[1], horaFim: match[2] || "", codigo: String(codigo) };
}

function formatDate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getBaseUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL.replace(/\/$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function buildPublicLinks(req, item) {
  const base = getBaseUrl(req);
  return {
    consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`,
    motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`,
    voucher: `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`,
    checkin: `${base}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`,
    checkout: `${base}/api/public/checkout/${encodeURIComponent(item.checkinToken)}`
  };
}

function formatPublicAgendamento(item, req) {
  const links = buildPublicLinks(req, item);
  return {
    id: item.id,
    protocolo: item.protocolo,
    status: item.status,
    semaforo: trafficColor(item.status),
    fornecedor: item.fornecedor,
    transportadora: item.transportadora,
    motorista: item.motorista,
    cpfMotorista: item.cpfMotorista,
    telefoneMotorista: item.telefoneMotorista,
    motoristaCpf: item.motoristaCpf,
    emailMotorista: item.emailMotorista,
    emailTransportadora: item.emailTransportadora,
    placa: item.placa,
    dataAgendada: item.dataAgendada,
    horaAgendada: item.horaAgendada,
    doca: item.doca?.codigo || "A DEFINIR",
    janela: item.janela?.codigo || "-",
    observacoes: item.observacoes || "",
    quantidadeNotas: item.quantidadeNotas,
    quantidadeVolumes: item.quantidadeVolumes,
    pesoTotal: item.pesoTotal || 0,
    valorTotal: item.valorTotal || 0,
    motivoReprovacao: item.motivoReprovacao,
    motivoCancelamento: item.motivoCancelamento,
    checkinEm: item.checkinEm,
    inicioDescargaEm: item.inicioDescargaEm,
    fimDescargaEm: item.fimDescargaEm,
    notasFiscais: item.notasFiscais || [],
    documentos: item.documentos || [],
    publicTokenMotorista: item.publicTokenMotorista,
    publicTokenFornecedor: item.publicTokenFornecedor,
    checkinToken: item.checkinToken,
    links
  };
}

function canDriverCancel(item) {
  if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW", "EM_DESCARGA"].includes(item.status)) {
    return { allowed: false, reason: "Status não permite cancelamento." };
  }
  const schedule = new Date(`${item.dataAgendada}T${item.horaAgendada}:00`);
  const diffHours = (schedule.getTime() - Date.now()) / 36e5;
  if (!Number.isFinite(diffHours) || diffHours < 24) {
    return { allowed: false, reason: "Cancelamento permitido apenas com 24h de antecedência." };
  }
  return { allowed: true, reason: "Cancelamento disponível." };
}

async function resolveAgendamentoByAnyToken(token) {
  return prisma.agendamento.findFirst({
    where: {
      OR: [
        { publicTokenFornecedor: token },
        { publicTokenMotorista: token },
        { checkinToken: token }
      ]
    },
    include: { notasFiscais: true, doca: true, janela: true, documentos: true }
  });
}

async function getOrCreateDocaPadrao() {
  const existing = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } });
  if (existing) return existing;
  const first = await prisma.doca.findFirst({ orderBy: { id: "asc" } });
  if (first) return first;
  return prisma.doca.create({ data: { codigo: "A DEFINIR", descricao: "Doca definida pelo operador no recebimento" } });
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

async function loadAgendamentos(datas) {
  try {
    return await prisma.agendamento.findMany({
      where: { dataAgendada: { in: datas }, status: { in: ACTIVE_STATUSES } },
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
    return { agenda: [], meta: { dias, capacidadePorHorario: 0, totalDocas: docas.length, motivo: "Nenhuma janela cadastrada" } };
  }

  const capacidadePorHorario = Math.max(docas.filter((doca) => doca.codigo !== "A DEFINIR").length, 1);
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

  const agenda = datas.map((data) => ({
    data,
    disponivel: false,
    horarios: janelas.map((janela) => {
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
    })
  })).map((dia) => ({ ...dia, disponivel: dia.horarios.some((slot) => slot.disponivel > 0) }));

  return { agenda, meta: { dias, capacidadePorHorario, totalDocas: docas.length, totalJanelas: janelas.length } };
}

router.get("/disponibilidade", async (req, res) => {
  try {
    const diasRaw = Number(req.query?.dias || 21);
    const dias = Number.isFinite(diasRaw) ? Math.min(Math.max(diasRaw, 1), 60) : 21;
    res.json(await buildAgenda({ dias }));
  } catch (err) {
    console.error("Erro em /public/disponibilidade:", err);
    res.status(500).json({ message: err?.message || "Falha ao consultar disponibilidade." });
  }
});

router.get("/fornecedores-pendentes", async (_req, res) => {
  try {
    const itens = await prisma.relatorioTerceirizado.findMany({
      where: { status: "AGUARDANDO_CHEGADA", agendamentoId: null },
      orderBy: [{ fornecedor: "asc" }, { id: "desc" }]
    });
    res.json(itens.map((item) => ({
      id: item.id,
      fornecedor: item.fornecedor,
      transportadora: item.transportadora,
      motorista: item.motorista,
      cpfMotorista: item.cpfMotorista,
      placa: item.placa,
      quantidadeNotas: item.quantidadeNotas,
      quantidadeVolumes: item.quantidadeVolumes,
      pesoTotalKg: item.pesoTotalKg,
      valorTotalNf: item.valorTotalNf
    })));
  } catch (err) {
    res.status(500).json({ message: err?.message || "Falha ao consultar fornecedores pendentes." });
  }
});

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const janelaId = Number(payload.janelaId);
    if (!janelaId) return res.status(400).json({ message: "Janela é obrigatória." });

    const janela = await prisma.janela.findUnique({ where: { id: janelaId } });
    if (!janela) return res.status(404).json({ message: "Janela não encontrada." });

    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const doca = await getOrCreateDocaPadrao();

    const relatorio = payload.relatorioTerceirizadoId ? await prisma.relatorioTerceirizado.findUnique({ where: { id: Number(payload.relatorioTerceirizadoId) } }) : null;
    const notas = normalizeNotas(payload.notas || (relatorio?.notasJson ? JSON.parse(relatorio.notasJson) : []));
    const resumo = summarizeNotas(notas);

    const totaisNotas = calculateNotasTotals(notas);

    const totaisNotas = calculateNotasTotals(notas);

    const totaisNotas = calculateNotasTotals(notas);

    const agendamentoPayload = {
      fornecedor: String(payload.fornecedor || "").trim(),
      transportadora: String(payload.transportadora || "").trim(),
      motorista: String(payload.motorista || "").trim(),
      motoristaCpf: normalizeCpf(payload.motoristaCpf || ""),
      telefoneMotorista: String(payload.telefoneMotorista || "").trim(),
      emailMotorista: String(payload.emailMotorista || "").trim(),
      emailTransportadora: String(payload.emailTransportadora || "").trim(),
      placa: String(relatorio?.placa || payload.placa || "").trim().toUpperCase(),
      dataAgendada: String(payload.dataAgendada || "").trim(),
      horaAgendada,
      janelaId,
      docaId: doca.id,
      quantidadeNotas: totaisNotas.quantidadeNotas,
      quantidadeVolumes: totaisNotas.quantidadeVolumes,
      pesoTotal: totaisNotas.pesoTotal,
      valorTotal: totaisNotas.valorTotal,
      observacoes: String(payload.observacoes || "").trim(),
      lgpdConsent: Boolean(payload.lgpdConsent)
    };

    validateAgendamentoPayload(agendamentoPayload, true);
    validateNfBatch(notas);

    await assertJanelaDocaDisponivel({ docaId: doca.id, janelaId, dataAgendada: agendamentoPayload.dataAgendada });

    const created = await prisma.agendamento.create({
      data: {
        protocolo: generateProtocol(),
        publicTokenMotorista: generateCpfBasedMotoristaToken(agendamentoPayload.motoristaCpf),
        publicTokenFornecedor: generatePublicToken("FOR"),
        checkinToken: generatePublicToken("CHK"),
        fornecedor: agendamentoPayload.fornecedor,
        transportadora: agendamentoPayload.transportadora,
        motorista: agendamentoPayload.motorista,
        motoristaCpf: agendamentoPayload.motoristaCpf,
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
        pesoTotal: agendamentoPayload.pesoTotal,
        valorTotal: agendamentoPayload.valorTotal,
        status: "PENDENTE_APROVACAO",
        observacoes: agendamentoPayload.observacoes,
        lgpdConsentAt: new Date()
      }
    });

    if (notas.length) {
      await prisma.notaFiscal.createMany({
        data: notas.map((nota) => ({ ...nota, agendamentoId: created.id }))
      });
    }

    if (relatorio) {
      await prisma.relatorioTerceirizado.update({
        where: { id: relatorio.id },
        data: { agendamentoId: created.id, status: "AGENDADO" }
      });
    }

    const full = await prisma.agendamento.findUnique({
      where: { id: created.id },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
    const links = buildPublicLinks(req, full);

    res.status(201).json({
      ok: true,
      id: full.id,
      protocolo: full.protocolo,
      horaAgendada,
      doca: full.doca?.codigo || "A DEFINIR",
      linkMotorista: links.motorista,
      linkFornecedor: links.consulta,
      voucher: links.voucher,
      tokenMotorista: full.publicTokenMotorista,
      tokenConsulta: full.publicTokenFornecedor
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/motorista/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenMotorista: req.params.token },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
    if (!item) return res.status(404).json({ message: "Token inválido." });
    const cancelamento = canDriverCancel(item);
    res.json({ ...formatPublicAgendamento(item, req), cancelamento });
  } catch (err) {
    console.error("Erro em /public/motorista:", err);
    res.status(500).json({ message: err?.message || "Falha ao consultar acompanhamento do motorista." });
  }
});

router.post("/motorista/:token/cancelar", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({ where: { publicTokenMotorista: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token inválido." });
    const rule = canDriverCancel(item);
    if (!rule.allowed) return res.status(400).json({ message: rule.reason });

    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: { status: "CANCELADO", motivoCancelamento: String(req.body?.motivo || "Cancelado pelo motorista").trim() || "Cancelado pelo motorista" }
    });
    res.json({ ok: true, message: "Agendamento cancelado com sucesso.", agendamento: updated });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/consulta/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenFornecedor: req.params.token },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
    if (!item) return res.status(404).json({ message: "Token inválido." });
    res.json(formatPublicAgendamento(item, req));
  } catch (err) {
    console.error("Erro em /public/consulta:", err);
    res.status(500).json({ message: err?.message || "Falha ao consultar agendamento." });
  }
});

router.get("/fornecedor/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({
      where: { publicTokenFornecedor: req.params.token },
      include: { notasFiscais: true, doca: true, janela: true, documentos: true }
    });
    if (!item) return res.status(404).json({ message: "Token inválido." });
    res.json(formatPublicAgendamento(item, req));
  } catch (err) {
    console.error("Erro em /public/fornecedor:", err);
    res.status(500).json({ message: err?.message || "Falha ao consultar agendamento." });
  }
});

router.post("/fornecedor/:token/notas", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({ where: { publicTokenFornecedor: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token inválido." });

    const payload = {
      ...req.body,
      chaveAcesso: normalizeChaveAcesso(req.body?.chaveAcesso || "")
    };
    validateNf(payload);

    const nf = await prisma.notaFiscal.create({
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

    const notasAtualizadas = await prisma.notaFiscal.findMany({ where: { agendamentoId: item.id } });
    const resumoAtualizado = summarizeNotas(notasAtualizadas);
    await prisma.agendamento.update({ where: { id: item.id }, data: resumoAtualizado });
    res.status(201).json(nf);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/fornecedores-pendentes", async (_req, res) => {
  try {
    const itens = await prisma.agendamento.findMany({
      where: { status: { in: ["PENDENTE_APROVACAO", "APROVADO"] } },
      select: { fornecedor: true },
      distinct: ["fornecedor"],
      orderBy: { fornecedor: "asc" }
    });
    res.json({ fornecedores: itens.map((item) => item.fornecedor).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ message: err?.message || "Falha ao carregar fornecedores pendentes." });
  }
});

router.get("/voucher/:token", async (req, res) => {
  try {
    const item = await resolveAgendamentoByAnyToken(req.params.token);
    if (!item) return res.status(404).json({ message: "Token inválido." });
    const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename=voucher-${item.protocolo}.pdf`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ message: err?.message || "Falha ao gerar voucher." });
  }
});

router.post("/checkin/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token de check-in inválido." });
    if (!["APROVADO", "CHEGOU"].includes(item.status)) {
      return res.status(400).json({ message: "Check-in só permitido para agendamentos aprovados." });
    }

    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: { status: "CHEGOU", checkinEm: item.checkinEm || new Date() }
    });

    res.json({ ok: true, message: "Check-in realizado com sucesso.", agendamento: updated });
  } catch (err) {
    console.error("Erro em /public/checkin:", err);
    res.status(500).json({ message: err?.message || "Falha ao realizar check-in." });
  }
});
router.post("/checkout/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token de check-out inválido." });
    if (!["CHEGOU", "EM_DESCARGA"].includes(item.status)) {
      return res.status(400).json({ message: "Check-out só permitido para cargas que já chegaram." });
    }

    const updated = await prisma.agendamento.update({
      where: { id: item.id },
      data: { status: "FINALIZADO", inicioDescargaEm: item.inicioDescargaEm || item.checkinEm || new Date(), fimDescargaEm: new Date() }
    });

    res.json({ ok: true, message: "Check-out realizado com sucesso.", agendamento: updated });
  } catch (err) {
    console.error("Erro em /public/checkout:", err);
    res.status(500).json({ message: err?.message || "Falha ao realizar check-out." });
  }
});
<<<<<<< HEAD
=======
<<<<<<< HEAD
=======

router.post("/checkout/:token", async (req, res) => {
  try {
    const item = await prisma.agendamento.findUnique({ where: { checkinToken: req.params.token } });
    if (!item) return res.status(404).json({ message: "Token de check-out inválido." });
    if (!["CHEGOU", "EM_DESCARGA", "FINALIZADO"].includes(item.status)) {
      return res.status(400).json({ message: "Check-out só permitido após a chegada do veículo." });
    }

    const updated = item.status === "FINALIZADO" ? item : await prisma.agendamento.update({
      where: { id: item.id },
      data: {
        status: "FINALIZADO",
        inicioDescargaEm: item.inicioDescargaEm || new Date(),
        fimDescargaEm: item.fimDescargaEm || new Date()
      }
    });

    res.json({ ok: true, message: "Check-out realizado com sucesso.", agendamento: updated });
  } catch (err) {
    console.error("Erro em /public/checkout:", err);
    res.status(500).json({ message: err?.message || "Falha ao realizar check-out." });
  }
});
>>>>>>> 442936730811b0fee8facf12b4d7ad2ea1759d4c
>>>>>>> a4a3038f95bb66ba18786ae2350f8262d6a7ef3d

export default router;
