import dotenv from "dotenv";
dotenv.config();

export const env = {
  port: Number(process.env.PORT || 3000),
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET || "development-secret",
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
  whatsappBaseUrl: process.env.WHATSAPP_BASE_URL || ""
};
