import { env } from "../config/env.js";

export async function sendWhatsApp({ to, message }) {
  if (!env.whatsappEnabled) {
    return { sent: false, reason: "WhatsApp desabilitado" };
  }

  if (env.whatsappProvider === "stub") {
    return { sent: false, reason: "Provider stub configurado. Implementar provedor real." };
  }

  return { sent: false, reason: "Integração não implementada para o provider atual." };
}
