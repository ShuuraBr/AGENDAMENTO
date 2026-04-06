import nodemailer from "nodemailer";
import { env } from "../config/env.js";

function createTransporter() {
  if (!env.smtpHost || !env.smtpUser || !env.smtpPass) {
    return null;
  }

  return nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPass
    }
  });
}

export async function sendEmail({ to, subject, html, text }) {
  const transporter = createTransporter();
  if (!transporter) {
    return { sent: false, reason: "SMTP não configurado" };
  }

  const info = await transporter.sendMail({
    from: env.mailFrom || env.smtpUser,
    to,
    subject,
    text,
    html
  });

  return { sent: true, messageId: info.messageId };
}
