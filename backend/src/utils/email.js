import nodemailer from "nodemailer";
import { logEmailDispatch } from "./telemetry.js";

function buildTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function summarizeRecipients(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function smtpSnapshot() {
  return {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    userConfigured: !!process.env.SMTP_USER,
    passConfigured: !!process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER || ""
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isMailConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function verifyMailTransport({ timeoutMs = Number(process.env.SMTP_VERIFY_TIMEOUT_MS || 8000) } = {}) {
  if (!isMailConfigured()) {
    return {
      ok: false,
      configured: false,
      message: "SMTP não configurado.",
      smtp: smtpSnapshot()
    };
  }

  const tx = buildTransporter();
  const startedAt = Date.now();
  try {
    await Promise.race([
      tx.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout ao validar SMTP após ${timeoutMs} ms.`)), timeoutMs))
    ]);
    return {
      ok: true,
      configured: true,
      message: "SMTP validado com sucesso.",
      durationMs: Date.now() - startedAt,
      smtp: smtpSnapshot()
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      message: error?.message || "Falha ao validar SMTP.",
      code: error?.code || null,
      durationMs: Date.now() - startedAt,
      smtp: smtpSnapshot()
    };
  }
}

export async function sendMail({ to, cc, bcc, subject, text, html, attachments = [] }) {
  const recipients = {
    to: summarizeRecipients(to),
    cc: summarizeRecipients(cc),
    bcc: summarizeRecipients(bcc)
  };
  const baseLog = {
    subject: String(subject || "").slice(0, 200),
    recipients,
    attachmentsCount: Array.isArray(attachments) ? attachments.length : 0
  };

  if (!isMailConfigured()) {
    const result = { sent: false, reason: "SMTP não configurado", attempts: 0 };
    logEmailDispatch({ ...baseLog, ...result, smtp: smtpSnapshot() });
    return result;
  }

  const attempts = Math.max(1, Number(process.env.SMTP_RETRY_ATTEMPTS || 3));
  const retryDelayMs = Math.max(250, Number(process.env.SMTP_RETRY_DELAY_MS || 1200));
  const tx = buildTransporter();
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const info = await tx.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to,
        cc,
        bcc,
        subject,
        text,
        html,
        attachments
      });
      const result = {
        sent: true,
        messageId: info.messageId,
        attempts: attempt,
        durationMs: Date.now() - startedAt
      };
      logEmailDispatch({ ...baseLog, ...result });
      return result;
    } catch (error) {
      lastError = error;
      logEmailDispatch({
        ...baseLog,
        sent: false,
        attempt,
        durationMs: Date.now() - startedAt,
        reason: error?.message || "Falha ao enviar e-mail.",
        code: error?.code || null
      });
      if (attempt < attempts) await wait(retryDelayMs * attempt);
    }
  }

  return {
    sent: false,
    reason: lastError?.message || "Falha ao enviar e-mail.",
    code: lastError?.code || null,
    attempts
  };
}
