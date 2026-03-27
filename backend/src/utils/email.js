import nodemailer from "nodemailer";

function transporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

export async function sendMail({ to, subject, text, html }) {
  const tx = transporter();
  if (!tx) return { sent: false, reason: "SMTP não configurado" };
  const info = await tx.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to, subject, text, html
  });
  return { sent: true, messageId: info.messageId };
}
