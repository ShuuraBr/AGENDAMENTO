import { env } from '../config/env.js';

/**
 * Envia mensagem via WhatsApp usando o provedor configurado.
 *
 * @param {object}  opts
 * @param {string}  opts.to              – Telefone do destinatário (DDI+DDD+número, ex: 5511999998888)
 * @param {string}  opts.message         – Texto da mensagem (usado em provedores que aceitam texto livre)
 * @param {string}  [opts.name]          – Nome do destinatário (usado pelo template da Duotalk)
 * @param {string}  [opts.voucherUrl]    – URL pública do voucher PDF
 * @param {string}  [opts.dataAgendada]  – Data agendada formatada (dd/mm/aaaa) → variável {{1}} do template
 * @param {string}  [opts.horaAgendada]  – Hora agendada (HH:mm) → variável {{2}} do template
 */
export async function sendWhatsApp({ to, message, name, voucherUrl, dataAgendada, horaAgendada } = {}) {
  console.log(`[WHATSAPP] sendWhatsApp chamado → to=${to}, name=${name}, provider=${env.whatsappProvider}, apiUrl=${env.whatsappApiUrl ? 'SET' : 'EMPTY'}`);

  if (env.whatsappProvider === 'mock') {
    console.log('[WHATSAPP] Provider=mock, retornando simulado.');
    return { ok: false, simulated: true, provider: 'mock', to, message };
  }

  if (!env.whatsappApiUrl) {
    console.log('[WHATSAPP] WHATSAPP_API_URL não configurada. Retornando simulado.');
    return { ok: false, simulated: true, reason: 'WhatsApp não configurado (WHATSAPP_API_URL ausente)' };
  }

  const provider = String(env.whatsappProvider || '').toLowerCase();

  if (provider === 'duotalk') {
    console.log('[WHATSAPP] Chamando sendViaDuotalk...');
    const result = await sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada, apiUrl: env.whatsappApiUrl });
    console.log('[WHATSAPP] Resultado Duotalk:', JSON.stringify(result));
    return result;
  }

  console.log(`[WHATSAPP] Provider "${env.whatsappProvider}" não reconhecido.`);
  return {
    ok: false,
    simulated: true,
    reason: `Provider "${env.whatsappProvider}" não possui implementação. Use "duotalk" ou "mock".`,
  };
}

/**
 * Envia a mensagem de confirmação ("deseja receber mensagens sobre este
 * agendamento?") usando um template separado (WHATSAPP_CONFIRMACAO_API_URL).
 *
 * Mensagens de WhatsApp Business iniciadas pela empresa (fora de uma janela
 * de atendimento de 24h aberta pelo cliente) precisam de um template
 * pré-aprovado — por isso não é possível reaproveitar o template do voucher
 * com um texto livre diferente. É necessário cadastrar este novo template no
 * provedor (Duotalk) perguntando se o motorista deseja receber mensagens
 * sobre o agendamento (sim/não), e configurar a URL dele em
 * WHATSAPP_CONFIRMACAO_API_URL.
 *
 * @param {object} opts
 * @param {string} opts.to              – Telefone do destinatário
 * @param {string} [opts.name]          – Nome do destinatário
 * @param {string} [opts.dataAgendada]  – Data agendada formatada (dd/mm/aaaa) → {{1}}
 * @param {string} [opts.horaAgendada]  – Hora agendada (HH:mm) → {{2}}
 */
export async function sendWhatsAppConfirmacao({ to, name, dataAgendada, horaAgendada } = {}) {
  console.log(`[WHATSAPP-CONFIRMACAO] sendWhatsAppConfirmacao chamado → to=${to}, name=${name}, provider=${env.whatsappProvider}, apiUrl=${env.whatsappConfirmacaoApiUrl ? 'SET' : 'EMPTY'}`);

  if (env.whatsappProvider === 'mock') {
    return { ok: false, simulated: true, provider: 'mock', to };
  }

  if (!env.whatsappConfirmacaoApiUrl) {
    console.log('[WHATSAPP-CONFIRMACAO] WHATSAPP_CONFIRMACAO_API_URL não configurada. Retornando simulado.');
    return { ok: false, simulated: true, reason: 'Template de confirmação não configurado (WHATSAPP_CONFIRMACAO_API_URL ausente)' };
  }

  const provider = String(env.whatsappProvider || '').toLowerCase();

  if (provider === 'duotalk') {
    const result = await sendViaDuotalk({ to, name, dataAgendada, horaAgendada, apiUrl: env.whatsappConfirmacaoApiUrl });
    console.log('[WHATSAPP-CONFIRMACAO] Resultado Duotalk:', JSON.stringify(result));
    return result;
  }

  return {
    ok: false,
    simulated: true,
    reason: `Provider "${env.whatsappProvider}" não possui implementação. Use "duotalk" ou "mock".`,
  };
}

/**
 * Monta o texto do voucher no mesmo formato da mensagem original.
 */
export function buildVoucherMessageText({ name, dataAgendada, horaAgendada, voucherUrl }) {
  const linhas = [
    `Olá, ${name || 'Motorista'}! O seu agendamento de descarga foi confirmado para o dia ${dataAgendada || '-'} às ${horaAgendada || '-'}. 🚚`,
    '',
    '📄 O seu voucher de liberação encontra-se no link abaixo.',
    voucherUrl || '',
    '',
    '⚠️ Avisos Importantes:',
    '* Chegue com antecedência ao local.',
    '* É obrigatório o uso de EPI (Equipamento de Proteção Individual).',
    '* O motorista deve estar obrigatoriamente acompanhado de um auxiliar para realizar a descarga.',
    '',
    'Boa viagem e conduza com segurança!',
    'Digite "sair" para não receber novas mensagens',
  ];
  return linhas.join('\n');
}

/**
 * Envia o voucher como mensagem de texto livre (sessão aberta) via Duotalk.
 * Usa WHATSAPP_VOUCHER_TEXT_API_URL — endpoint do Duotalk para enviar texto em
 * conversa já aberta (diferente da campanha, que exige conversa nova).
 *
 * Exemplo de URL esperada: https://api.duotalk.io/api/v1/message  (verificar docs)
 */
export async function sendVoucherTextMessage({ to, name, dataAgendada, horaAgendada, voucherUrl } = {}) {
  const textApiUrl = env.whatsappVoucherTextApiUrl;
  console.log(`[WHATSAPP-VOUCHER-TEXT] sendVoucherTextMessage → to=${to}, textApiUrl=${textApiUrl ? 'SET' : 'EMPTY'}`);

  if (!textApiUrl) {
    console.log('[WHATSAPP-VOUCHER-TEXT] WHATSAPP_VOUCHER_TEXT_API_URL não configurada. Retornando simulado.');
    return { ok: false, simulated: true, reason: 'WHATSAPP_VOUCHER_TEXT_API_URL não configurada' };
  }

  let phone = String(to || '').replace(/\D/g, '');
  if (!phone) return { ok: false, reason: 'Telefone vazio ou inválido' };
  if (phone.length <= 11) phone = `55${phone}`;

  const message = buildVoucherMessageText({ name, dataAgendada, horaAgendada, voucherUrl });
  console.log(`[WHATSAPP-VOUCHER-TEXT] Enviando para ${phone}: ${message.substring(0, 80)}...`);

  try {
    const response = await fetch(textApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (response.ok) {
      return { ok: true, simulated: false, provider: 'duotalk-text', to: phone, data };
    }
    return { ok: false, simulated: false, provider: 'duotalk-text', to: phone, status: response.status, reason: data?.message || data?.error || text };
  } catch (err) {
    return { ok: false, simulated: false, provider: 'duotalk-text', to: phone, reason: err.message || String(err) };
  }
}

/** Formata data ISO ou Date para dd/mm/aaaa */
function formatDateBR(value) {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Integração com a Duotalk (WhatsApp Business API via 360Dialog).
 * Faz POST para a URL do template configurada em WHATSAPP_API_URL,
 * enviando name e phone no body, e as variáveis do template como
 * query params (&queryParams=true&1=data&2=hora).
 */
async function sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada, apiUrl: apiUrlOverride }) {
  let phone = String(to || '').replace(/\D/g, '');
  if (!phone) {
    return { ok: false, simulated: false, provider: 'duotalk', reason: 'Telefone vazio ou inválido' };
  }

  // Garante formato internacional (DDI 55 para Brasil)
  // Números com 10-11 dígitos sem DDI recebem prefixo 55 automaticamente
  if (phone.length <= 11) {
    phone = `55${phone}`;
  }
  console.log(`[WHATSAPP] Telefone formatado: ${phone}`);

  const contactName = name || 'Motorista';

  // Monta a URL com as variáveis do template como query params
  // Template voucher:      {1}=nome, {2}=data, {3}=hora, {4}=link
  // Template confirmação:  {1}=data, {2}=hora  (nome via {NOME_CONTATO} no template)
  const baseUrl = apiUrlOverride || env.whatsappApiUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  // voucherUrl é passado apenas para o template do voucher; confirmação não o passa.
  // Template voucher:     body.name={NOME_CONTATO}, {2}=data, {3}=hora, {4}=link
  // Template confirmação: body.name={NOME_CONTATO}, {1}=data, {2}=hora
  const isVoucher = voucherUrl !== undefined;
  const qp = isVoucher
    ? { queryParams: 'true', '2': dataAgendada || '-', '3': horaAgendada || '-', '4': voucherUrl || '' }
    : { queryParams: 'true', '1': dataAgendada || '-', '2': horaAgendada || '-' };
  const templateParams = new URLSearchParams(qp);
  const apiUrl = `${baseUrl}${separator}${templateParams.toString()}`;
  console.log(`[WHATSAPP] URL com query params: ${apiUrl}`);

  const body = {
    name: contactName,
    phone,
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (response.ok) {
      return { ok: true, simulated: false, provider: 'duotalk', to: phone, data };
    }

    return {
      ok: false,
      simulated: false,
      provider: 'duotalk',
      to: phone,
      status: response.status,
      reason: data?.message || data?.error || text,
    };
  } catch (err) {
    return {
      ok: false,
      simulated: false,
      provider: 'duotalk',
      to: phone,
      reason: err.message || String(err),
    };
  }
}