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
  const now = new Date();

  // Se já existe outra confirmação PENDENTE para este telefone, não envia nova mensagem.
  // O watcher resolveria todos de uma vez quando o motorista responder.
  const existingPendente = await prisma.agendamento.findFirst({
    where: {
      whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE,
      whatsappConfirmacaoTelefone: normalizedPhone,
      id: { not: Number(agendamento.id) },
    },
    select: { id: true },
  });

  if (existingPendente) {
    console.log(`[WHATSAPP-CONFIRMACAO] Já existe agendamento PENDENTE (id=${existingPendente.id}) para telefone=${normalizedPhone}. Registrando status sem reenviar mensagem.`);
    await prisma.agendamento.update({
      where: { id: Number(agendamento.id) },
      data: {
        whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE,
        whatsappConfirmacaoTelefone: normalizedPhone,
        whatsappConfirmacaoEnviadoEm: now,
        whatsappConfirmacaoUltimoEnvioEm: now,
        whatsappConfirmacaoTentativas: 1,
        whatsappConfirmacaoRespondidoEm: null,
        voucherWhatsappEnviado: 0,
        voucherWhatsappEnviadoEm: null,
      },
    });
    return { sent: false, reason: `Confirmação já pendente para este telefone (agendamento id=${existingPendente.id}). Aguardando resposta do motorista.` };
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

    let totalVouchersEnviados = 0;
    for (const agendamento of pendentes) {
      await prisma.agendamento.update({
        where: { id: Number(agendamento.id) },
        data: {
          whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.ACEITOU,
          whatsappConfirmacaoRespondidoEm: now,
        },
      });

      // Se já aprovado, envia voucher imediatamente; senão aguarda aprovação.
      const agendamentoStatusUpper = String(agendamento.status || '').toUpperCase();
      if (VOUCHER_ALLOWED_STATUSES.has(agendamentoStatusUpper)) {
        console.log(`[WHATSAPP-REPLY] Agendamento id=${agendamento.id} já ${agendamentoStatusUpper} → enviando voucher agora.`);
        const sentVoucher = await sendVoucherWhatsApp(agendamento);
        if (sentVoucher?.ok) totalVouchersEnviados += 1;
      } else {
        console.log(`[WHATSAPP-REPLY] Agendamento id=${agendamento.id} ainda não aprovado (status=${agendamentoStatusUpper}) → voucher será enviado na aprovação.`);
      }

      await auditLog({
        acao: "CONFIRMACAO_WHATSAPP_ACEITA",
        entidade: "AGENDAMENTO",
        entidadeId: agendamento.id,
        detalhes: { telefone: normalizedPhone, texto: text, voucherEnviado: VOUCHER_ALLOWED_STATUSES.has(String(agendamento.status || '').toUpperCase()) },
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
 */
export async function runVoucherConfirmationWatcherTick() {
  const pendentes = await prisma.agendamento.findMany({
    where: { whatsappConfirmacaoStatus: CONFIRMACAO_STATUS.PENDENTE },
  });

  const now = Date.now();
  let reenviados = 0;
  let semContato = 0;

  // Agrupa por telefone para não enviar múltiplas confirmações para o mesmo número.
  // Para timeout, processa todos; para reenvio, usa apenas o mais recente por telefone.
  const byPhone = new Map();
  for (const ag of pendentes) {
    const phone = ag.whatsappConfirmacaoTelefone || normalizePhone(ag.telefoneMotorista || "");
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push(ag);
  }

  for (const [phone, grupo] of byPhone) {
    // Ordena do mais recente ao mais antigo (por id).
    grupo.sort((a, b) => Number(b.id) - Number(a.id));

    for (const agendamento of grupo) {
      const enviadoEm = agendamento.whatsappConfirmacaoEnviadoEm
        ? new Date(agendamento.whatsappConfirmacaoEnviadoEm).getTime()
        : null;
      if (!enviadoEm || Number.isNaN(enviadoEm)) continue;
      const elapsed = now - enviadoEm;

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
      }
    }

    // Reenvio: usa apenas o agendamento mais recente do grupo que ainda não esgotou.
    // Isso evita enviar múltiplas confirmações para o mesmo motorista.
    const maisRecente = grupo.find((ag) => {
      const enviadoEm = ag.whatsappConfirmacaoEnviadoEm
        ? new Date(ag.whatsappConfirmacaoEnviadoEm).getTime()
        : null;
      if (!enviadoEm || Number.isNaN(enviadoEm)) return false;
      const elapsed = now - enviadoEm;
      return elapsed < TIMEOUT_AFTER_MS;
    });

    if (!maisRecente) continue;

    const enviadoEm = new Date(maisRecente.whatsappConfirmacaoEnviadoEm).getTime();
    const elapsed = now - enviadoEm;
    const jaReenviou = Number(maisRecente.whatsappConfirmacaoTentativas || 0) >= 2;

    if (!jaReenviou && elapsed >= RESEND_AFTER_MS) {
      const sentWhats = await sendWhatsAppConfirmacao({
        to: maisRecente.telefoneMotorista,
        name: maisRecente.motorista || maisRecente.nomeMotorista || "Motorista",
        dataAgendada: formatDateBR(maisRecente?.dataAgendada),
        horaAgendada: formatHourLabel(maisRecente?.horaAgendada),
      });
      const reenvioNow = new Date();
      // Incrementa tentativas apenas no agendamento que enviou; os demais recebem apenas o timestamp.
      for (const ag of grupo) {
        const isRemetente = ag.id === maisRecente.id;
        await prisma.agendamento.update({
          where: { id: Number(ag.id) },
          data: {
            whatsappConfirmacaoUltimoEnvioEm: reenvioNow,
            ...(isRemetente && {
              whatsappConfirmacaoTentativas: Number(maisRecente.whatsappConfirmacaoTentativas || 0) + 1,
            }),
          },
        });
      }
      await auditLog({
        acao: "REENVIAR_CONFIRMACAO_WHATSAPP",
        entidade: "AGENDAMENTO",
        entidadeId: maisRecente.id,
        detalhes: { telefone: phone, totalAgendamentosNoGrupo: grupo.length, ...sentWhats },
      });
      reenviados += 1;
    }
  }

  return { checados: pendentes.length, reenviados, semContato };
}