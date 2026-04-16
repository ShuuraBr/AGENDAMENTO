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
  if (env.whatsappProvider === 'mock') {
    return { ok: false, simulated: true, provider: 'mock', to, message };
  }

  if (!env.whatsappApiUrl) {
    return { ok: false, simulated: true, reason: 'WhatsApp não configurado (WHATSAPP_API_URL ausente)' };
  }

  const provider = String(env.whatsappProvider || '').toLowerCase();

  if (provider === 'duotalk') {
    return sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada });
  }

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
 * enviando name, phone e as variáveis do template ({{1}}=data, {{2}}=hora).
 */
async function sendViaDuotalk({ to, name, message, voucherUrl, dataAgendada, horaAgendada }) {
  const phone = String(to || '').replace(/\D/g, '');
  if (!phone) {
    return { ok: false, simulated: false, provider: 'duotalk', reason: 'Telefone vazio ou inválido' };
  }

  const contactName = name || 'Motorista';
  const apiUrl = env.whatsappApiUrl;

  const body = {
    name: contactName,
    phone,
    params: [
      dataAgendada || '-',
      horaAgendada || '-',
    ],
  };

  if (voucherUrl) {
    body.document = voucherUrl;
  }

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
