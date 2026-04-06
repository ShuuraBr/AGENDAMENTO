import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

function createTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) return null;

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass,
    },
  });
}

export async function sendEmail({ to, subject, html, text, attachments = [] }) {
  const transporter = createTransporter();
  if (!transporter) {
    return { ok: false, simulated: true, reason: 'SMTP não configurado' };
  }

  const info = await transporter.sendMail({
    from: env.smtpFrom,
    to,
    subject,
    html,
    text,
    attachments,
  });

  return { ok: true, simulated: false, messageId: info.messageId };
}
