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
    const result = await sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada });
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
async function sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada }) {
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
  // {{1}}=data, {{2}}=hora, {{3}}=link do voucher PDF
  const baseUrl = env.whatsappApiUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  const qp = {
    queryParams: 'true',
    '1': dataAgendada || '-',
    '2': horaAgendada || '-',
  };
  if (voucherUrl) {
    qp['3'] = voucherUrl;
  }
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
