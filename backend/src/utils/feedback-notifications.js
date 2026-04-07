import { ensureFeedbackRequest } from './driver-feedback.js';
import { sendMail } from './email.js';

export function formatDateBR(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

export function buildFeedbackLink(baseUrl, token) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  return `${base}/?view=avaliacao&token=${encodeURIComponent(token)}`;
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

  const request = await ensureFeedbackRequest(agendamento);
  const feedbackLink = buildFeedbackLink(baseUrl, request.token);
  const subject = `Avaliação de atendimento - agendamento ${agendamento.protocolo}`;
  const text = [
    'Olá, motorista.',
    '',
    'Sua operação foi concluída. Queremos ouvir sua avaliação sobre o atendimento recebido no recebimento.',
    `Protocolo: ${agendamento.protocolo}`,
    `Data agendada: ${formatDateBR(agendamento.dataAgendada)}`,
    `Horário: ${agendamento.horaAgendada || '-'}`,
    '',
    'A pesquisa é confidencial e pode ser respondida apenas uma vez.',
    `Link do formulário: ${feedbackLink}`
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.55;max-width:680px;margin:0 auto;">
      <div style="padding:24px;border:1px solid #dbe2ea;border-radius:18px;background:#ffffff;">
        <h2 style="margin:0 0 12px;color:#16355c;">Avaliação do atendimento</h2>
        <p style="margin:0 0 12px;">Sua operação foi concluída. Queremos ouvir sua avaliação sobre o atendimento recebido no recebimento.</p>
        <p style="margin:0 0 4px;"><strong>Protocolo:</strong> ${agendamento.protocolo}</p>
        <p style="margin:0 0 4px;"><strong>Data agendada:</strong> ${formatDateBR(agendamento.dataAgendada)}</p>
        <p style="margin:0 0 18px;"><strong>Horário:</strong> ${agendamento.horaAgendada || '-'}</p>
        <p style="margin:0 0 18px;">A pesquisa é confidencial e pode ser respondida apenas uma vez.</p>
        <p style="margin:0;">
          <a href="${feedbackLink}" style="display:inline-block;background:#16355c;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;">Responder avaliação</a>
        </p>
      </div>
    </div>
  `;

  const sent = await sendMail({
    to: agendamento.emailMotorista,
    subject,
    text,
    html
  });

  return {
    ...sent,
    to: agendamento.emailMotorista,
    feedbackLink,
    token: request.token,
    request
  };
}
