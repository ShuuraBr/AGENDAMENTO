import express from "express";
import { prisma } from "../utils/prisma.js";
import { generateProtocol, generatePublicToken } from "../utils/security.js";
import { validateAgendamentoPayload, validateNf, normalizeChaveAcesso } from "../utils/validators.js";
import { assertJanelaDocaDisponivel, trafficColor } from "../utils/operations.js";
import { fetchJanelasDocas, fetchAgendamentosByDatasStatuses } from "../utils/db-fallback.js";
import { generateVoucherPdf } from "../utils/voucher-pdf.js";
import { calculateTotals, normalizeCpf } from "../utils/agendamento-helpers.js";
import {
  readJanelas, readDocas, readAgendamentos, readFornecedoresPendentes,
  createAgendamentoFile, findAgendamentoByTokenFile, findAgendamentoFile, updateAgendamentoFile, ensureDocaPadraoFile
} from "../utils/file-store.js";

const router = express.Router();
const ACTIVE_STATUSES = ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"];

function validateNfBatch(notas = []) { for (const nota of notas) validateNf(nota || {}); }
function parseJanelaCodigo(codigo = "") { const m = String(codigo).match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/); return m ? { horaInicio: m[1], horaFim: m[2] || "", codigo: String(codigo) } : { horaInicio: String(codigo).trim() || "00:00", horaFim: "", codigo: String(codigo) }; }
function formatDate(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function getBaseUrl(req) { return process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, "") : `${req.protocol}://${req.get("host")}`; }
function buildLinks(req, item) { const base = getBaseUrl(req); return { consulta: `${base}/?view=consulta&token=${encodeURIComponent(item.publicTokenFornecedor)}`, motorista: `${base}/?view=motorista&token=${encodeURIComponent(item.publicTokenMotorista)}`, voucher: `${base}/api/public/voucher/${encodeURIComponent(item.publicTokenFornecedor)}`, checkin: `${base}/?view=checkin&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkinToken)}`, checkout: `${base}/?view=checkout&id=${encodeURIComponent(item.id)}&token=${encodeURIComponent(item.checkoutToken || '')}` }; }
function formatItem(item, req) { const links = buildLinks(req, item); return { ...item, semaforo: trafficColor(item.status), links, doca: item.doca?.codigo || item.doca || "A DEFINIR", janela: item.janela?.codigo || item.janela || "-" }; }
function canDriverCancel(item) { if (["FINALIZADO", "CANCELADO", "REPROVADO", "NO_SHOW", "EM_DESCARGA"].includes(item.status)) return { allowed: false, reason: "Status não permite cancelamento." }; const schedule = new Date(`${item.dataAgendada}T${item.horaAgendada}:00`); const diffHours = (schedule.getTime() - Date.now()) / 36e5; return !Number.isFinite(diffHours) || diffHours < 24 ? { allowed: false, reason: "Cancelamento permitido apenas com 24h de antecedência." } : { allowed: true, reason: "Cancelamento disponível." }; }

async function getOrCreateDocaPadrao() {
  try {
    const existing = await prisma.doca.findFirst({ where: { codigo: "A DEFINIR" }, orderBy: { id: "asc" } });
    if (existing) return existing;
    const first = await prisma.doca.findFirst({ orderBy: { id: "asc" } });
    if (first) return first;
    return prisma.doca.create({ data: { codigo: "A DEFINIR", descricao: "Doca definida pelo operador do recebimento" } });
  } catch {
    return ensureDocaPadraoFile();
  }
}

async function resolveByToken(token) {
  try {
    return await prisma.agendamento.findFirst({ where: { OR: [{ publicTokenFornecedor: token }, { publicTokenMotorista: token }, { checkinToken: token }, { checkoutToken: token }] }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
  } catch {
    return findAgendamentoByTokenFile(token);
  }
}

router.get("/disponibilidade", async (req, res) => {
  const dias = Math.max(1, Math.min(31, Number(req.query?.dias || 14)));
  try {
    const { janelas, docas } = await fetchJanelasDocas();
    const hoje = new Date();
    const datas = Array.from({ length: dias }, (_, index) => { const next = new Date(hoje); next.setDate(hoje.getDate() + index); return formatDate(next); });
    const agenda = await Promise.all(datas.map(async (data) => {
      const ocupados = await fetchAgendamentosByDatasStatuses([data], ACTIVE_STATUSES);
      const horarios = janelas.map((janela) => {
        const parsed = parseJanelaCodigo(janela.codigo);
        const ocupadosJanela = ocupados.filter((ag) => String(ag.janelaId || ag.janela?.id || ag.janela || '') === String(janela.id) || String(ag.horaAgendada || '') === parsed.horaInicio).length;
        const capacidade = Math.max(docas.length, 1);
        return { janelaId: janela.id, hora: parsed.horaInicio, horaFim: parsed.horaFim, descricao: janela.descricao || janela.codigo || '', ocupados: ocupadosJanela, disponivel: Math.max(capacidade - ocupadosJanela, 0), ativo: Math.max(capacidade - ocupadosJanela, 0) > 0 };
      });
      return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios };
    }));
    return res.json({ agenda, meta: { dias, origem: 'database' } });
  } catch {
    const janelas = readJanelas(); const docas = readDocas(); const all = readAgendamentos(); const hoje = new Date();
    const agenda = Array.from({ length: dias }, (_, index) => { const next = new Date(hoje); next.setDate(hoje.getDate() + index); const data = formatDate(next); const horarios = janelas.map((janela) => { const parsed = parseJanelaCodigo(janela.codigo); const ocupados = all.filter((ag) => String(ag.dataAgendada) === data && ACTIVE_STATUSES.includes(ag.status) && (String(ag.janelaId || '') === String(janela.id) || String(ag.horaAgendada || '') === parsed.horaInicio)).length; const capacidade = Math.max(docas.length, 1); return { janelaId: janela.id, hora: parsed.horaInicio, horaFim: parsed.horaFim, descricao: janela.descricao || janela.codigo || '', ocupados, disponivel: Math.max(capacidade - ocupados, 0), ativo: Math.max(capacidade - ocupados, 0) > 0 }; }); return { data, disponivel: horarios.some((item) => item.disponivel > 0), horarios }; });
    return res.json({ agenda, meta: { dias, origem: 'arquivo' } });
  }
});

router.get("/fornecedores-pendentes", async (_req, res) => { res.json(readFornecedoresPendentes()); });

router.post("/solicitacao", async (req, res) => {
  try {
    const payload = { ...(req.body || {}) };
    const janelaId = Number(payload.janelaId);
    if (!janelaId) return res.status(400).json({ message: "Janela é obrigatória." });
    const cpfMotorista = normalizeCpf(payload.cpfMotorista || payload.cpf || '');
    const notas = Array.isArray(payload.notas) ? payload.notas.map((nota) => ({ numeroNf: String(nota?.numeroNf || "").trim(), serie: String(nota?.serie || "").trim(), chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""), volumes: Number(nota?.volumes || 0), peso: Number(nota?.peso || 0), valorNf: Number(nota?.valorNf || 0), observacao: String(nota?.observacao || "").trim() })) : [];
    validateNfBatch(notas);
    const totals = calculateTotals(notas, payload);
    const doca = await getOrCreateDocaPadrao();
    let janela; try { janela = await prisma.janela.findUnique({ where: { id: janelaId } }); } catch {}
    janela ||= readJanelas().find((item) => Number(item.id) === janelaId);
    if (!janela) return res.status(404).json({ message: "Janela não encontrada." });
    const horaAgendada = parseJanelaCodigo(janela.codigo).horaInicio;
    const agendamentoPayload = { fornecedor: String(payload.fornecedor || "").trim(), transportadora: String(payload.transportadora || "").trim(), motorista: String(payload.motorista || "").trim(), cpfMotorista, telefoneMotorista: String(payload.telefoneMotorista || "").trim(), emailMotorista: String(payload.emailMotorista || "").trim(), emailTransportadora: String(payload.emailTransportadora || "").trim(), placa: String(payload.placa || "").trim().toUpperCase(), dataAgendada: String(payload.dataAgendada || "").trim(), horaAgendada, janelaId, docaId: doca.id, observacoes: String(payload.observacoes || "").trim(), lgpdConsent: Boolean(payload.lgpdConsent), ...totals };
    validateAgendamentoPayload(agendamentoPayload, true);

    try {
      await assertJanelaDocaDisponivel({ docaId: doca.id, janelaId, dataAgendada: agendamentoPayload.dataAgendada });
      const created = await prisma.agendamento.create({ data: { protocolo: generateProtocol(), publicTokenMotorista: generatePublicToken("MOT", cpfMotorista), publicTokenFornecedor: generatePublicToken("FOR", agendamentoPayload.fornecedor), checkinToken: generatePublicToken("CHK", cpfMotorista || agendamentoPayload.placa), checkoutToken: generatePublicToken("OUT", cpfMotorista || agendamentoPayload.placa), ...agendamentoPayload, status: "PENDENTE_APROVACAO", lgpdConsentAt: new Date() } });
      if (notas.length) await prisma.notaFiscal.createMany({ data: notas.map((nota) => ({ ...nota, agendamentoId: created.id })) });
      const full = await prisma.agendamento.findUnique({ where: { id: created.id }, include: { notasFiscais: true, doca: true, janela: true, documentos: true } });
      const links = buildLinks(req, full);
      return res.status(201).json({ ok: true, id: full.id, protocolo: full.protocolo, horaAgendada, doca: full.doca?.codigo || "A DEFINIR", linkMotorista: links.motorista, linkFornecedor: links.consulta, voucher: links.voucher, tokenMotorista: full.publicTokenMotorista, tokenConsulta: full.publicTokenFornecedor, tokenCheckout: full.checkoutToken });
    } catch (dbErr) {
      const record = createAgendamentoFile({ protocolo: generateProtocol(), publicTokenMotorista: generatePublicToken("MOT", cpfMotorista), publicTokenFornecedor: generatePublicToken("FOR", agendamentoPayload.fornecedor), checkinToken: generatePublicToken("CHK", cpfMotorista || agendamentoPayload.placa), checkoutToken: generatePublicToken("OUT", cpfMotorista || agendamentoPayload.placa), ...agendamentoPayload, status: 'PENDENTE_APROVACAO', lgpdConsentAt: new Date().toISOString(), notasFiscais: notas, doca: doca.codigo || 'A DEFINIR', janela: janela.codigo });
      const links = buildLinks(req, record);
      return res.status(201).json({ ok: true, id: record.id, protocolo: record.protocolo, horaAgendada, doca: record.doca || "A DEFINIR", linkMotorista: links.motorista, linkFornecedor: links.consulta, voucher: links.voucher, tokenMotorista: record.publicTokenMotorista, tokenConsulta: record.publicTokenFornecedor, tokenCheckout: record.checkoutToken, origem: 'arquivo' });
    }
  } catch (err) { res.status(400).json({ message: err.message }); }
});

router.get("/motorista/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token inválido.' }); res.json({ ...formatItem(item, req), cancelamento: canDriverCancel(item) }); });
router.post("/motorista/:token/cancelar", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token inválido.' }); const rule = canDriverCancel(item); if (!rule.allowed) return res.status(400).json({ message: rule.reason }); try { const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: 'CANCELADO', motivoCancelamento: String(req.body?.motivo || 'Cancelado pelo motorista').trim() } }); return res.json({ ok: true, message: 'Agendamento cancelado com sucesso.', agendamento: updated }); } catch { const updated = updateAgendamentoFile(item.id, { status: 'CANCELADO', motivoCancelamento: String(req.body?.motivo || 'Cancelado pelo motorista').trim() }); return res.json({ ok: true, message: 'Agendamento cancelado com sucesso.', agendamento: updated }); } });
router.get("/consulta/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token inválido.' }); res.json(formatItem(item, req)); });
router.get("/fornecedor/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token inválido.' }); res.json(formatItem(item, req)); });
router.get("/voucher/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token inválido.' }); const pdf = await generateVoucherPdf(item, { baseUrl: getBaseUrl(req) }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename=voucher-${item.protocolo}.pdf`); res.send(pdf); });
router.post("/checkin/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token de check-in inválido.' }); if (!["APROVADO", "CHEGOU"].includes(item.status)) return res.status(400).json({ message: 'Check-in só permitido para agendamentos aprovados.' }); try { const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: 'CHEGOU', checkinEm: item.checkinEm || new Date() } }); return res.json({ ok: true, message: 'Check-in realizado com sucesso.', agendamento: updated }); } catch { const updated = updateAgendamentoFile(item.id, { status: 'CHEGOU', checkinEm: item.checkinEm || new Date().toISOString() }); return res.json({ ok: true, message: 'Check-in realizado com sucesso.', agendamento: updated }); } });
router.post("/checkout/:token", async (req, res) => { const item = await resolveByToken(req.params.token); if (!item) return res.status(404).json({ message: 'Token de check-out inválido.' }); if (!["CHEGOU", "EM_DESCARGA"].includes(item.status)) return res.status(400).json({ message: 'Check-out só permitido após a chegada.' }); try { const updated = await prisma.agendamento.update({ where: { id: item.id }, data: { status: 'FINALIZADO', fimDescargaEm: new Date() } }); return res.json({ ok: true, message: 'Check-out realizado com sucesso.', agendamento: updated }); } catch { const updated = updateAgendamentoFile(item.id, { status: 'FINALIZADO', fimDescargaEm: new Date().toISOString() }); return res.json({ ok: true, message: 'Check-out realizado com sucesso.', agendamento: updated }); } });

export default router;
