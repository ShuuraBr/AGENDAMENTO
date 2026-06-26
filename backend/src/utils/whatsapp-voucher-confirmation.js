// Fluxo de opt-in via WhatsApp antes do envio do voucher.
//
// 1) Após a aprovação do agendamento, em vez de enviar o voucher direto pelo
//    WhatsApp, enviamos uma mensagem perguntando se o motorista deseja
//    receber mensagens sobre o agendamento.
// 2) Se responder "sim" → enviamos o voucher normalmente.
// 3) Se responder "não" → não enviamos o voucher e marcamos no agendamento
//    que ele recusou.
// 4) Se não responder em RESEND_AFTER_MS, reenviamos a mesma mensagem uma vez.
// 5) Se ainda assim não responder até completar TIMEOUT_AFTER_MS (a partir do
//    primeiro envio), marcamos o agendamento como "sem contato".
//
// O ponto de entrada `runVoucherConfirmationWatcherTick` deve ser chamado
// periodicamente (ver server.js) e `processIncomingWhatsAppReply` deve ser
// chamado pelo webhook que recebe as respostas do provedor de WhatsApp.

import { prisma } from "./prisma.js";
import { sendWhatsApp, sendWhatsAppConfirmacao, sendVoucherTextMessage } from "../services/whatsAppService.js";
import { auditLog } from "./audit.js";
import { env } from "../config/env.js";

export const RESEND_AFTER_MS = 20 * 60 * 1000;
export const TIMEOUT_AFTER_MS = 40 * 60 * 1000;

// Locks in-memory por telefone para serializar envios concorrentes dentro do mesmo processo.
const confirmacaoLocks = new Map(); // phone → Promise
const voucherLocks = new Map();     // phone → Promise

async function withPhoneLock(lockMap, phone, fn) {
  // Loop: re-verifica após acordar para cobrir o caso em que mais de dois
  // callers estavam aguardando o mesmo lock e um deles já tomou o próximo slot.
  while (lockMap.has(phone)) {
    await lockMap.get(phone).catch(() => {});
  }
  let release;
  const lock = new Promise((res) => { release = res; });
  lockMap.set(phone, lock);
  try {
    return await fn();
  } finally {
    release();
    if (lockMap.get(phone) === lock) lockMap.delete(phone);
  }
}

export const CONFIRMACAO_STATUS = {
  PENDENTE: "PENDENTE",
  ACEITOU: "ACEITOU",
  RECUSOU: "RECUSOU",
  SEM_CONTATO: "SEM_CONTATO",
};

function getBaseUrl() {
  return String(env.frontendUrl || "").replace(/\/$/, "");
}

function formatDateBR(value) {
  if (!value) return "-";
  const raw = String(value).trim();
  const compact = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (compact) return `${compact[3]}/${compact[2]}/${compact[1]}`;
  return raw || "-";
}

function formatHourLabel(value) {
  if (!value) return "-";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : raw || "-";
}

/** Normaliza telefone para dígitos com DDI 55, igual ao usado no envio do WhatsApp. */
export function normalizePhone(value) {
  let phone = String(value || "").replace(/\D/g, "");
  if (!phone) return "";
  if (phone.length <= 11) phone = `55${phone}`;
  return phone;
}

function buildVoucherUrl(agendamento) {
  const base = getBaseUrl();
  if (!base || !agendamento?.publicTokenFornecedor) return "";
  return `${base}/api/public/voucher/${encodeURIComponent(agendamento.publicTokenFornecedor)}`;
}

/**
 * Dispara a mensagem de opt-in para o telefone do motorista e marca o
 * agendamento como aguardando confirmação. Deve ser chamada no lugar do
 * envio direto do voucher pelo WhatsApp.
 */
export async function requestVoucherConfirmation(agendamento, { actor } = {}) {
  const telefone = agendamento?.telefoneMotorista;
  if (!telefone) {
    return { sent: false, reason: "Não há telefone do motorista cadastrado." };
  }
  const normalizedPhone = normalizePhone(telefone);
  return withPhoneLock(confirmacaoLocks, normalizedPhone, () =>
    _requestVoucherConfirmacaoLocked(agendamento, normalizedPhone, { actor })
  );
}

async function _requestVoucherConfirmacaoLocked(agendamento, normalizedPhone, { actor } = {}) {
  const telefone = agendamento.telefoneMotorista;
  const now = new Date();

  // Idempotência: se este agendamento já enviou sua mensagem de confirmação,
  // não envia novamente (protege contra chamadas duplicadas no mesmo agendamento).
  if (agendamento.whatsappConfirmacaoEnviadoEm) {
    console.log(`[WHATSAPP-CONFIRMACAO] Agendamento id=${agendamento.id} já enviou confirmação em ${new Date(agendamento.whatsappConfirmacaoEnviadoEm).toISOString()}. Ignorando.`);
    return { sent: false, reason: `Confirmação já enviada para este agendamento (id=${agendamento.id}).` };
  }

  const nome = agendamento.motorista || agendamento.nomeMotorista || "Motorista";
  const sentWhats = await sendWhatsAppConfirmacao({
    to: telefone,
    name: nome,
    dataAgendada: formatDateBR(agendamento?.dataAgendada),
    horaAgendada: formatHourLabel(agendamento?.horaAgendada),
  });
  const sentNow = new Date();
  await prisma.agendamento.update({
    where: { id: Number(agendamento.id) },
    data: {
      whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE,
      whatsappConfirmacaoTelefone: normalizedPhone,
      whatsappConfirmacaoEnviadoEm: sentNow,
      whatsappConfirmacaoUltimoEnvioEm: sentNow,
      whatsappConfirmacaoTentativas: 1,
      whatsappConfirmacaoRespondidoEm: null,
      voucherWhatsappEnviado: 0,
      voucherWhatsappEnviadoEm: null,
    },
  });

  await auditLog({
    usuarioId: actor?.sub || actor?.id || null,
    usuarioNome: actor?.nome || actor?.name || null,
    perfil: actor?.perfil || null,
    acao: "ENVIAR_CONFIRMACAO_WHATSAPP",
    entidade: "AGENDAMENTO",
    entidadeId: agendamento.id,
    detalhes: { to: telefone, ...sentWhats },
  });

  return { sent: true, tipo: "whatsapp-confirmacao", to: telefone, ...sentWhats };
}

const VOUCHER_ALLOWED_STATUSES = new Set(["APROVADO", "CHEGOU", "EM_DESCARGA", "FINALIZADO"]);

/** Envia de fato o voucher pelo WhatsApp (usado após a confirmação "sim"). */
export async function sendVoucherWhatsApp(agendamento) {
  const telefone = agendamento.telefoneMotorista;
  if (!telefone) return { sent: false, ok: false, reason: "Sem telefone." };
  const normalizedPhone = normalizePhone(telefone);
  return withPhoneLock(voucherLocks, normalizedPhone, () =>
    _sendVoucherWhatsAppLocked(agendamento, normalizedPhone)
  );
}

async function _sendVoucherWhatsAppLocked(agendamento, normalizedPhone) {
  const telefone = agendamento.telefoneMotorista;

  // Idempotência por agendamento: se este agendamento já recebeu o voucher, não envia de novo.
  if (Number(agendamento.voucherWhatsappEnviado) === 1) {
    console.log(`[WHATSAPP-VOUCHER] Voucher já enviado para agendamento id=${agendamento.id}. Ignorando.`);
    return { ok: false, sent: false, reason: `Voucher já enviado para este agendamento (id=${agendamento.id}).` };
  }

  const voucherUrl = buildVoucherUrl(agendamento);
  const nome = agendamento.motorista || agendamento.nomeMotorista || "Motorista";
  const dataAgendada = formatDateBR(agendamento?.dataAgendada);
  const horaAgendada = formatHourLabel(agendamento?.horaAgendada);
  console.log(`[WHATSAPP-VOUCHER] Enviando voucher → agendamentoId=${agendamento.id}, to=${telefone}, voucherUrl=${voucherUrl || '(vazio)'}`);

  // Prefere enviar como mensagem de texto na conversa aberta (janela 24h).
  // Fallback para campanha se a URL de texto não estiver configurada.
  let sentWhats;
  if (env.whatsappVoucherTextApiUrl) {
    sentWhats = await sendVoucherTextMessage({ to: telefone, name: nome, dataAgendada, horaAgendada, voucherUrl });
  } else {
    sentWhats = await sendWhatsApp({ to: telefone, name: nome, voucherUrl, dataAgendada, horaAgendada });
  }
  console.log(`[WHATSAPP-VOUCHER] Resultado → ok=${sentWhats?.ok}, simulated=${sentWhats?.simulated}, reason=${sentWhats?.reason || '-'}`);

  await prisma.agendamento.update({
    where: { id: Number(agendamento.id) },
    data: {
      voucherWhatsappEnviado: sentWhats?.ok ? 1 : 0,
      voucherWhatsappEnviadoEm: new Date(),
    },
  });

  return sentWhats;
}

const AFFIRMATIVE_REGEX = /^(sim|s|yes|y|1|ok|claro|aceito|quero)$/i;
const NEGATIVE_REGEX = /^(nao|não|n|no|2|negativo|recuso)$/i;

function normalizeReplyText(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove acentos
}

/**
 * Processa uma resposta recebida via webhook do provedor de WhatsApp.
 * Busca o agendamento mais recente com confirmação pendente para o telefone
 * informado e interpreta a resposta como "sim"/"não".
 */
export async function processIncomingWhatsAppReply({ phone, text }) {
  const normalizedPhone = normalizePhone(phone);
  console.log(`[WHATSAPP-REPLY] Processando resposta → phone=${phone}, normalizedPhone=${normalizedPhone}, text="${text}"`);
  if (!normalizedPhone) {
    return { handled: false, reason: "Telefone ausente ou inválido no webhook." };
  }

  // Busca TODOS os agendamentos pendentes do telefone para resolver todos de uma vez.
  // Assim uma única resposta "Sim" ou "Não" encerra todas as confirmações em aberto
  // para este motorista, evitando que o watcher reenvie confirmações para registros antigos.
  const pendentes = await prisma.agendamento.findMany({
    where: {
      whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE,
      whatsappConfirmacaoTelefone: normalizedPhone,
    },
    orderBy: { id: "desc" },
  });

  if (!pendentes.length) {
    console.warn(`[WHATSAPP-REPLY] Nenhum agendamento PENDENTE encontrado para telefone=${normalizedPhone}. Pode indicar migração V14 não executada, status já alterado, ou telefone diferente do armazenado.`);
    return { handled: false, reason: "Nenhum agendamento com confirmação pendente para este telefone." };
  }

  console.log(`[WHATSAPP-REPLY] ${pendentes.length} agendamento(s) PENDENTE(s) encontrado(s) para telefone=${normalizedPhone}: ids=[${pendentes.map((a) => a.id).join(', ')}]`);
  const normalizedText = normalizeReplyText(text);
  const now = new Date();

  if (AFFIRMATIVE_REGEX.test(normalizedText)) {
    console.log(`[WHATSAPP-REPLY] Resposta AFIRMATIVA → atualizando ${pendentes.length} agendamento(s) para ACEITOU`);

    // Marca todos como ACEITOU
    for (const agendamento of pendentes) {
      await prisma.agendamento.update({
        where: { id: Number(agendamento.id) },
        data: {
          whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.ACEITOU,
          whatsappConfirmacaoRespondidoEm: now,
        },
      });
    }

    let totalVouchersEnviados = 0;

    for (const agendamento of pendentes) {
      // Voucher: cada agendamento aprovado recebe o seu próprio, independente dos demais.
      const estaAprovado = VOUCHER_ALLOWED_STATUSES.has(String(agendamento.status || '').toUpperCase());
      if (estaAprovado) {
        const sentVoucher = await sendVoucherWhatsApp(agendamento);
        if (sentVoucher?.ok) totalVouchersEnviados += 1;
      }

      await auditLog({
        acao: "CONFIRMACAO_WHATSAPP_ACEITA",
        entidade: "AGENDAMENTO",
        entidadeId: agendamento.id,
        detalhes: { telefone: normalizedPhone, texto: text, voucherEnviado: estaAprovado },
      });
    }

    return { handled: true, status: CONFIRMACAO_STATUS.ACEITOU, agendamentosIds: pendentes.map((a) => a.id), vouchersEnviados: totalVouchersEnviados };
  }

  if (NEGATIVE_REGEX.test(normalizedText)) {
    console.log(`[WHATSAPP-REPLY] Resposta NEGATIVA → atualizando ${pendentes.length} agendamento(s) para RECUSOU`);
    for (const agendamento of pendentes) {
      await prisma.agendamento.update({
        where: { id: Number(agendamento.id) },
        data: {
          whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.RECUSOU,
          whatsappConfirmacaoRespondidoEm: now,
        },
      });
      await auditLog({
        acao: "CONFIRMACAO_WHATSAPP_RECUSADA",
        entidade: "AGENDAMENTO",
        entidadeId: agendamento.id,
        detalhes: { telefone: normalizedPhone, texto: text },
      });
    }
    return { handled: true, status: CONFIRMACAO_STATUS.RECUSOU, agendamentosIds: pendentes.map((a) => a.id) };
  }

  // Resposta não reconhecida: não altera o status, deixa o watcher
  // de timeout/reenvio decidir o que fazer.
  console.warn(`[WHATSAPP-REPLY] Resposta não reconhecida como sim/não → text="${text}", normalizedText="${normalizedText}"`);
  return { handled: false, reason: "Resposta não reconhecida como sim/não.", agendamentosIds: pendentes.map((a) => a.id), texto: text };
}

/**
 * Verifica agendamentos com confirmação pendente: reenvia a mensagem uma vez
 * aos RESEND_AFTER_MS e marca como SEM_CONTATO ao completar TIMEOUT_AFTER_MS
 * (contados a partir do primeiro envio). Deve ser chamada periodicamente.
 *
 * Cada agendamento é tratado de forma independente — sem agrupamento por telefone.
 * O reenvio usa updateMany com condição atômica (tentativas < 2) para proteger
 * contra múltiplos processos do servidor executando o watcher simultaneamente.
 */
export async function runVoucherConfirmationWatcherTick() {
  const pendentes = await prisma.agendamento.findMany({
    where: { whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE },
    orderBy: { id: "desc" },
  });

  const now = Date.now();
  let reenviados = 0;
  let semContato = 0;

  // Telefones que já receberam reenvio neste tick — evita spam quando o mesmo
  // motorista tem múltiplos agendamentos PENDENTE (ex: duplicatas).
  const phonesSentThisTick = new Set();

  for (const agendamento of pendentes) {
    const enviadoEm = agendamento.whatsappConfirmacaoEnviadoEm
      ? new Date(agendamento.whatsappConfirmacaoEnviadoEm).getTime()
      : null;
    if (!enviadoEm || Number.isNaN(enviadoEm)) continue;

    const elapsed = now - enviadoEm;
    const phone = agendamento.whatsappConfirmacaoTelefone || normalizePhone(agendamento.telefoneMotorista || "");

    if (elapsed >= TIMEOUT_AFTER_MS) {
      await prisma.agendamento.update({
        where: { id: Number(agendamento.id) },
        data: { whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.SEM_CONTATO },
      });
      await auditLog({
        acao: "CONFIRMACAO_WHATSAPP_SEM_CONTATO",
        entidade: "AGENDAMENTO",
        entidadeId: agendamento.id,
        detalhes: { telefone: phone },
      });
      semContato += 1;
      continue;
    }

    const tentativas = Number(agendamento.whatsappConfirmacaoTentativas || 0);
    // Só reenvia 1 vez (tentativas passa de 1 para 2); a confirmação inicial
    // já foi feita com tentativas=1 por requestVoucherConfirmation.
    if (tentativas >= 2 || elapsed < RESEND_AFTER_MS) continue;

    // Não reenvia se já enviamos para este telefone neste tick.
    if (phone && phonesSentThisTick.has(phone)) {
      console.log(`[WHATSAPP-WATCHER] Reenvio ignorado para phone=${phone} agendamentoId=${agendamento.id} — telefone já processado neste tick.`);
      continue;
    }

    // Update atômico: só prossegue se nenhum outro processo já incrementou tentativas.
    const updated = await prisma.agendamento.updateMany({
      where: { id: Number(agendamento.id), whatsappConfirmacaoTentativas: { lt: 2 } },
      data: { whatsappConfirmacaoTentativas: 2, whatsappConfirmacaoUltimoEnvioEm: new Date() },
    });
    if (updated.count === 0) continue;

    if (phone) phonesSentThisTick.add(phone);

    const sentWhats = await sendWhatsAppConfirmacao({
      to: agendamento.telefoneMotorista,
      name: agendamento.motorista || agendamento.nomeMotorista || "Motorista",
      dataAgendada: formatDateBR(agendamento?.dataAgendada),
      horaAgendada: formatHourLabel(agendamento?.horaAgendada),
    });
    await auditLog({
      acao: "REENVIAR_CONFIRMACAO_WHATSAPP",
      entidade: "AGENDAMENTO",
      entidadeId: agendamento.id,
      detalhes: { telefone: phone, ...sentWhats },
    });
    reenviados += 1;
  }

  return { checados: pendentes.length, reenviados, semContato };
}