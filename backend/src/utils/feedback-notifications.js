import { ensureFeedbackRequest } from './driver-feedback.js';
import { sendMail } from './email.js';

export function formatDateBR(value) {
  if (!value) return '-';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getUTCFullYear());
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const year = String(native.getUTCFullYear());
    const month = String(native.getUTCMonth() + 1).padStart(2, '0');
    const day = String(native.getUTCDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }
  return raw || '-';
}

export function buildFeedbackLink(baseUrl, token) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `${base}/?view=avaliacao&token=${encodeURIComponent(token)}`;
}

function isMissingScheduleValue(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || ['-', 'invalid date', 'null', 'undefined'].includes(normalized);
}


function normalizeHora(value, fallback = '') {
  const raw = String(value || fallback || '').trim();
  const match = raw.match(/^(\d{2}:\d{2})(?::\d{2})?$/);
  if (match) return match[1];
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const hh = String(native.getUTCHours()).padStart(2, '0');
    const mm = String(native.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
  return raw;
}

function deriveHoraFromJanela(agendamento = {}) {
  const janela = String(agendamento?.janela?.codigo || agendamento?.janela || '').trim();
  const match = janela.match(/(\d{2}:\d{2})/);
  return match ? match[1] : '';
}

function normalizeDateValue(value, fallback = '') {
  const rawValue = value ?? fallback;
  if (!rawValue) return '';
  if (rawValue instanceof Date && !Number.isNaN(rawValue.getTime())) {
    const year = String(rawValue.getUTCFullYear());
    const month = String(rawValue.getUTCMonth() + 1).padStart(2, '0');
    const day = String(rawValue.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = String(rawValue).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) {
    const year = String(native.getUTCFullYear());
    const month = String(native.getUTCMonth() + 1).padStart(2, '0');
    const day = String(native.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return raw;
}


function pickFeedbackDateCandidate(source = {}) {
  return source?.dataAgendada ?? source?.data_agendada ?? source?.dataProgramada ?? source?.data_programada ?? source?.data ?? source?.date ?? '';
}

function pickFeedbackTimeCandidate(source = {}) {
  return source?.horaAgendada ?? source?.hora_agendada ?? source?.horaProgramada ?? source?.hora_programada ?? source?.hora ?? source?.time ?? '';
}

function normalizeAgendamentoForFeedback(agendamento = {}, fallback = {}) {
  const primaryDateCandidate = pickFeedbackDateCandidate(agendamento);
  const fallbackDateCandidate = pickFeedbackDateCandidate(fallback);
  const primaryTimeCandidate = pickFeedbackTimeCandidate(agendamento);
  const fallbackTimeCandidate = pickFeedbackTimeCandidate(fallback);
  const dataAgendada = normalizeDateValue(
    isMissingScheduleValue(primaryDateCandidate) ? fallbackDateCandidate : primaryDateCandidate,
    normalizeDateValue(fallbackDateCandidate, '')
  );
  const horaAgendada = normalizeHora(
    isMissingScheduleValue(primaryTimeCandidate) ? fallbackTimeCandidate : primaryTimeCandidate,
    normalizeHora(fallbackTimeCandidate, deriveHoraFromJanela(agendamento) || deriveHoraFromJanela(fallback))
  ) || '-';

  return {
    ...fallback,
    ...agendamento,
    dataAgendada,
    horaAgendada
  };
}

export async function sendDriverFeedbackRequestEmail({ agendamento, baseUrl }) {
  if (!agendamento?.emailMotorista) {
    return {
      sent: false,
      reason: 'E-mail do motorista não informado.',
      to: null,
      feedbackLink: null,
      token: null
    };
  }

  const normalized = normalizeAgendamentoForFeedback(agendamento);
  const request = await ensureFeedbackRequest(normalized);
  const enriched = normalizeAgendamentoForFeedback(request || {}, normalized);
  const feedbackLink = buildFeedbackLink(baseUrl, request.token);
  const subject = `Avaliação de atendimento - agendamento ${enriched.protocolo}`;
  const text = [
    'Olá, motorista.',
    '',
    'Sua operação foi concluída. Queremos ouvir sua avaliação sobre o atendimento recebido no recebimento.',
    `Protocolo: ${enriched.protocolo}`,
    `Data agendada: ${formatDateBR(enriched.dataAgendada)}`,
    `Horário: ${enriched.horaAgendada || '-'}`,
    '',
    'A pesquisa é confidencial e pode ser respondida apenas uma vez.',
    `Link do formulário: ${feedbackLink}`
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:680px;margin:0 auto;">
      <div style="padding:24px;border:1px solid #dbe2ea;border-radius:18px;background:#ffffff;">
        <h2 style="margin:0 0 12px;color:#16355c;">Avaliação do atendimento</h2>
        <p style="margin:0 0 12px;">Sua operação foi concluída. Queremos ouvir sua avaliação sobre o atendimento recebido no recebimento.</p>
        <p style="margin:0 0 4px;"><strong>Protocolo:</strong> ${enriched.protocolo}</p>
        <p style="margin:0 0 4px;"><strong>Data agendada:</strong> ${formatDateBR(enriched.dataAgendada)}</p>
        <p style="margin:0 0 18px;"><strong>Horário:</strong> ${enriched.horaAgendada || '-'}</p>
        <p style="margin:0 0 18px;">A pesquisa é confidencial e pode ser respondida apenas uma vez.</p>
        <p style="margin:0;">
          <a href="${feedbackLink}" style="display:inline-block;background:#16355c;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Responder avaliação</a>
        </p>
      </div>
    </div>
  `;

  const sent = await sendMail({
    to: enriched.emailMotorista,
    subject,
    text,
    html
  });

  return {
    ...sent,
    to: enriched.emailMotorista,
    feedbackLink,
    token: request.token,
    request
  };
}
