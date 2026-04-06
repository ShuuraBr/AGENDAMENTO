import { env } from '../config/env.js';

export async function sendWhatsApp({ to, message }) {
  if (env.whatsappProvider === 'mock') {
    return { ok: false, simulated: true, provider: 'mock', to, message };
  }

  if (!env.whatsappApiUrl || !env.whatsappToken) {
    return { ok: false, simulated: true, reason: 'WhatsApp não configurado' };
  }

  // Estrutura pronta para integrar Twilio / Meta / CallMeBot / outro provedor.
  // Implementar conforme o provedor escolhido.
  return {
    ok: false,
    simulated: true,
    reason: `Provider ${env.whatsappProvider} precisa de implementação específica`,
  };
}
