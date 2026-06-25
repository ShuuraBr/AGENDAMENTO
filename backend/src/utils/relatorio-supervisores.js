import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';
import { prisma } from './prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const OPTIN_FILE = path.resolve(__dirname, '../../data/supervisores-optin.json');

const BRT_TIMEZONE = 'America/Sao_Paulo';

const brtFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: BRT_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function agoraBRT(referencia = new Date()) {
  const parts = Object.fromEntries(
    brtFmt.formatToParts(referencia).map((p) => [p.type, p.value])
  );
  return {
    hora:    parseInt(parts.hour,   10),
    minuto:  parseInt(parts.minute, 10),
    dataIso: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

function ontem() {
  const ontemRef = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BRT_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(
    dateFmt.formatToParts(ontemRef).map((p) => [p.type, p.value])
  );
  return {
    iso: `${parts.year}-${parts.month}-${parts.day}`,
    br:  `${parts.day}/${parts.month}/${parts.year}`,
  };
}

// ─── Opt-in state (arquivo JSON em data/) ────────────────────────────────────

export function normalizePhone(value) {
  let phone = String(value || '').replace(/\D/g, '');
  if (!phone) return '';
  if (phone.length <= 11) phone = `55${phone}`;
  return phone;
}

function carregarOptin() {
  try {
    if (fs.existsSync(OPTIN_FILE)) {
      // Remove BOM (﻿) que PowerShell adiciona em arquivos UTF-8
      const raw = fs.readFileSync(OPTIN_FILE, 'utf8').replace(/^﻿/, '');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('[RELATORIO-SUP] Erro ao ler opt-in:', err?.message);
  }
  return {};
}

function salvarOptin(state) {
  try {
    fs.writeFileSync(OPTIN_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('[RELATORIO-SUP] Erro ao salvar opt-in:', err?.message);
  }
}

// ─── Duotalk helpers ──────────────────────────────────────────────────────────

async function postDuotalk(apiUrl, phone, queryParams = {}) {
  const baseUrl = apiUrl.replace(/\\/g, '');
  const sep = baseUrl.includes('?') ? '&' : '?';
  // Constrói manualmente para não codificar barras da data (dd/mm/yyyy)
  const extra = Object.entries(queryParams).map(([k, v]) => `${k}=${v}`).join('&');
  const url = `${baseUrl}${sep}queryParams=true${extra ? '&' + extra : ''}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Supervisor', phone }),
    });
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (resp.ok) return { ok: true, to: phone, data };
    return { ok: false, to: phone, status: resp.status, reason: data?.message || data?.error || text };
  } catch (err) {
    return { ok: false, to: phone, reason: err?.message || String(err) };
  }
}

// ─── Opt-in: envio de confirmação ────────────────────────────────────────────

async function enviarConfirmacaoSupervisor(phone) {
  const apiUrl = env.whatsappSupervisoresConfirmacaoApiUrl;
  if (!apiUrl) {
    console.warn('[RELATORIO-SUP] WHATSAPP_SUPERVISORES_CONFIRMACAO_API_URL não configurada.');
    return { ok: false, reason: 'URL de confirmação não configurada' };
  }
  console.log(`[RELATORIO-SUP] Enviando opt-in para ${phone}...`);
  return postDuotalk(apiUrl, phone);
}

/**
 * Verifica a lista de supervisores configurada no .env e envia mensagem de
 * confirmação (opt-in) para qualquer número que ainda não tenha status definido.
 * Deve ser chamada na inicialização do servidor.
 */
export async function verificarEEnviarOptins() {
  if (process.env.SUPERVISORES_OPTIN_CONFIRMADO === 'true') {
    console.log('[RELATORIO-SUP] Opt-in já confirmado via env. Pulando envio de confirmação.');
    return;
  }
  const numerosRaw = env.supervisoresWhatsappNumeros || '';
  const numeros = numerosRaw.split(',').map((n) => n.trim()).filter(Boolean);
  if (numeros.length === 0) return;

  const state = carregarOptin();
  let alterado = false;

  for (const tel of numeros) {
    const phone = normalizePhone(tel);
    if (!phone) continue;
    if (state[phone]) continue; // já tem status — não reenvia

    const result = await enviarConfirmacaoSupervisor(phone);
    // Salva independente do resultado para não reenviar em cada restart.
    state[phone] = {
      status: 'PENDENTE',
      enviadoEm: new Date().toISOString(),
      respondidoEm: null,
    };
    alterado = true;
    if (!result.ok) {
      console.error(`[RELATORIO-SUP] Falha ao enviar opt-in para ${phone}: ${result.reason}. Marcado como PENDENTE para não reenviar.`);
    } else {
      console.log(`[RELATORIO-SUP] Opt-in enviado para ${phone}.`);
    }
  }

  if (alterado) salvarOptin(state);
}

// ─── Opt-in: processamento da resposta (chamado pelo webhook) ────────────────

const AFFIRMATIVE_REGEX = /^(sim|s|yes|y|1|ok|claro|aceito|quero)$/i;
const NEGATIVE_REGEX    = /^(nao|não|n|no|2|negativo|recuso)$/i;

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Tenta interpretar a resposta recebida via webhook como confirmação de um
 * supervisor. Retorna `{ handled: true }` se o telefone pertence à lista de
 * supervisores e a resposta foi reconhecida; caso contrário `{ handled: false }`.
 */
export function processarRespostaSupervisor({ phone, text }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { handled: false };

  const state = carregarOptin();
  if (!state[normalized]) return { handled: false }; // não é supervisor conhecido

  const txt = normalizeText(text);

  if (AFFIRMATIVE_REGEX.test(txt)) {
    state[normalized].status = 'ACEITOU';
    state[normalized].respondidoEm = new Date().toISOString();
    salvarOptin(state);
    console.log(`[RELATORIO-SUP] Supervisor ${normalized} ACEITOU receber relatórios diários.`);
    return { handled: true, status: 'ACEITOU', phone: normalized };
  }

  if (NEGATIVE_REGEX.test(txt)) {
    state[normalized].status = 'RECUSOU';
    state[normalized].respondidoEm = new Date().toISOString();
    salvarOptin(state);
    console.log(`[RELATORIO-SUP] Supervisor ${normalized} RECUSOU receber relatórios diários.`);
    return { handled: true, status: 'RECUSOU', phone: normalized };
  }

  return { handled: false };
}

// ─── Relatório diário ─────────────────────────────────────────────────────────

async function contarAgendamentosDodia(dataIso) {
  // 00:00 BRT = 03:00 UTC; 23:59:59 BRT = 02:59:59 UTC do dia seguinte
  const inicioUTC = new Date(`${dataIso}T03:00:00.000Z`);
  const fimUTC    = new Date(inicioUTC.getTime() + 24 * 60 * 60 * 1000 - 1);

  try {
    const total = await prisma.agendamento.count({
      where: { createdAt: { gte: inicioUTC, lte: fimUTC } },
    });
    return total;
  } catch (err) {
    console.error('[RELATORIO-SUP] Erro ao contar agendamentos:', err?.message || err);
    return null;
  }
}

async function enviarRelatorioParaSupervisor({ telefone, dataBR, total }) {
  const apiUrl = env.whatsappSupervisoresApiUrl;
  if (!apiUrl) {
    console.warn('[RELATORIO-SUP] WHATSAPP_SUPERVISORES_API_URL não configurada.');
    return { ok: false, reason: 'URL do relatório não configurada' };
  }
  const phone = normalizePhone(telefone);
  if (!phone) return { ok: false, reason: 'Telefone inválido' };

  // Template: "Bom dia {NOME_CONTATO}! Relatório de agendamentos criados em {2}: {3} agendamentos."
  const result = await postDuotalk(apiUrl, phone, { 2: dataBR, 3: String(total) });
  if (result.ok) {
    console.log(`[RELATORIO-SUP] Relatório enviado para ${phone} — ${dataBR}: ${total} agendamentos.`);
  } else {
    console.error(`[RELATORIO-SUP] Falha ao enviar para ${phone}:`, result.reason);
  }
  return result;
}

/**
 * Dispara o relatório diário apenas para supervisores que confirmaram o opt-in.
 */
export async function dispararRelatorioDiario() {
  const numerosRaw = env.supervisoresWhatsappNumeros || '';
  const numeros = numerosRaw.split(',').map((n) => n.trim()).filter(Boolean);

  if (numeros.length === 0) {
    console.warn('[RELATORIO-SUP] Nenhum número configurado em SUPERVISORES_WHATSAPP_NUMEROS.');
    return;
  }

  // Se opt-in confirmado via env, envia para todos os números sem checar o arquivo.
  let elegiveis;
  if (process.env.SUPERVISORES_OPTIN_CONFIRMADO === 'true') {
    elegiveis = numeros;
  } else {
    const state = carregarOptin();
    elegiveis = numeros.filter((tel) => state[normalizePhone(tel)]?.status === 'ACEITOU');
    if (elegiveis.length === 0) {
      console.warn('[RELATORIO-SUP] Nenhum supervisor aceitou o opt-in ainda. Relatório não enviado.');
      return;
    }
  }

  const { iso, br } = ontem();
  console.log(`[RELATORIO-SUP] Buscando agendamentos criados em ${br} (${iso})...`);

  const total = await contarAgendamentosDodia(iso);
  if (total === null) {
    console.error('[RELATORIO-SUP] Não foi possível obter o total. Envio abortado.');
    return;
  }

  console.log(`[RELATORIO-SUP] Total: ${total}. Disparando para ${elegiveis.length} supervisor(es)...`);
  const resultados = await Promise.all(elegiveis.map((tel) => enviarRelatorioParaSupervisor({ telefone: tel, dataBR: br, total })));
  // Retorna true se ao menos um envio foi bem-sucedido (usado pelo scheduler)
  return resultados.some((r) => r?.ok);
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

function carregarUltimoEnvio() {
  try {
    const state = carregarOptin();
    return state.__ultimoEnvioRelatorio || '';
  } catch { return ''; }
}

function salvarUltimoEnvio(dataIso) {
  try {
    const state = carregarOptin();
    state.__ultimoEnvioRelatorio = dataIso;
    salvarOptin(state);
  } catch (err) {
    console.error('[RELATORIO-SUP] Erro ao salvar data de envio:', err?.message);
  }
}

/**
 * Inicia o scheduler que dispara o relatório todo dia às 07:30 BRT.
 * - Verifica a cada 60 s.
 * - Persiste a data do último envio no JSON para sobreviver a restarts.
 * - Se o servidor subir depois das 07:30 e o relatório ainda não foi enviado
 *   hoje, dispara imediatamente.
 */
export function iniciarSchedulerRelatorio() {
  const disparar = (dataIso, hora, minuto) => {
    console.log(`[RELATORIO-SUP] Disparando relatório diário (${hora}:${String(minuto).padStart(2, '0')} BRT)`);
    dispararRelatorioDiario().then((enviou) => {
      // Só marca como enviado se ao menos um supervisor recebeu com sucesso
      if (enviou) salvarUltimoEnvio(dataIso);
    }).catch((err) => {
      console.error('[RELATORIO-SUP] Erro no disparo automático:', err?.message || err);
    });
  };

  const tick = () => {
    const { hora, minuto, dataIso } = agoraBRT();
    const ultimoEnvio = carregarUltimoEnvio();

    // Janela normal: 07:30–07:59 BRT (qualquer minuto após 07:30, no mesmo dia)
    if (hora === 7 && minuto >= 30 && ultimoEnvio !== dataIso) {
      disparar(dataIso, hora, minuto);
      return;
    }

    // Catch-up: servidor subiu depois das 07:30 (ex: 08:15) sem ter enviado hoje
    if (hora > 7 && hora < 23 && ultimoEnvio !== dataIso) {
      disparar(dataIso, hora, minuto);
    }
  };

  tick();
  const handle = setInterval(tick, 60 * 1000);
  handle.unref?.();
  return handle;
}
