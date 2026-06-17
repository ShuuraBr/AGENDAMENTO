import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const isProduction = process.env.NODE_ENV === "production";

if (!process.env.JWT_SECRET && isProduction) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required in production. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(64).toString('hex'))\""
  );
}

if (!process.env.JWT_SECRET) {
  console.warn(
    "[SECURITY WARNING] JWT_SECRET not set. Using random ephemeral key. " +
    "Sessions will NOT survive restarts. Set JWT_SECRET in .env for persistence."
  );
}

const ephemeralJwtSecret = crypto.randomBytes(64).toString("hex");

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "https://agenda.objetivaatacadista.com.br",
  jwtSecret: process.env.JWT_SECRET || ephemeralJwtSecret,
  corsOrigins: process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "https://agenda.objetivaatacadista.com.br",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 465),
  smtpSecure: String(process.env.SMTP_SECURE || "true") === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || "",
  smtpFrom: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER || "",
  uploadDir: process.env.UPLOAD_DIR || "uploads",
  whatsappEnabled: String(process.env.WHATSAPP_ENABLED || "false") === "true",
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "stub",
  whatsappToken: process.env.WHATSAPP_TOKEN || "",
  whatsappBaseUrl: process.env.WHATSAPP_BASE_URL || "",
  whatsappApiUrl: process.env.WHATSAPP_API_URL || process.env.WHATSAPP_BASE_URL || "",
  // Template separado para a mensagem de "deseja receber mensagens sobre este agendamento?".
  // Precisa ser um template de WhatsApp Business aprovado (mensagem iniciada pela empresa),
  // configurado no provedor (Duotalk) com a mesma lógica de queryParams do template do voucher.
  whatsappConfirmacaoApiUrl: process.env.WHATSAPP_CONFIRMACAO_API_URL || "",
  // Endpoint Duotalk para enviar mensagem de texto em conversa ABERTA (sessão 24h).
  // Diferente da campanha (WHATSAPP_API_URL) que só funciona para conversas novas.
  whatsappVoucherTextApiUrl: process.env.WHATSAPP_VOUCHER_TEXT_API_URL || "",
  // Token simples para validar a origem do webhook de respostas do WhatsApp (opcional).
  whatsappWebhookSecret: process.env.WHATSAPP_WEBHOOK_SECRET || ""
};