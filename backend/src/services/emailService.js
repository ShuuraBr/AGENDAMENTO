import { sendMail, verifyMailTransport, isMailConfigured } from '../utils/email.js';

export async function sendEmail({ to, cc, bcc, subject, html, text, attachments = [] }) {
  const result = await sendMail({ to, cc, bcc, subject, html, text, attachments });
  return {
    ok: !!result?.sent,
    sent: !!result?.sent,
    simulated: !isMailConfigured(),
    reason: result?.reason || null,
    messageId: result?.messageId || null,
    attempts: Number(result?.attempts || 0)
  };
}

export { verifyMailTransport, isMailConfigured };
