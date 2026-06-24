import { Router } from "express";
import { processIncomingWhatsAppReply } from "../utils/whatsapp-voucher-confirmation.js";
import { processarRespostaSupervisor } from "../utils/relatorio-supervisores.js";
import { env } from "../config/env.js";

const router = Router();

// NOTA: o formato exato do payload enviado pela Duotalk para mensagens
// recebidas não foi confirmado ainda. Este endpoint tenta extrair telefone e
// texto de algumas formas comuns de payload (incluindo o formato do
// WhatsApp Cloud API, que a Duotalk normalmente espelha). Ajuste os campos
// abaixo conforme o payload real recebido (verifique os logs em produção)
// depois de configurar esta URL no painel da Duotalk.
function extractPhoneAndText(body = {}) {
  // Formato WhatsApp Cloud API / 360Dialog via entry[].changes[].value.messages[]
  const cloudMessage = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (cloudMessage) {
    const text =
      cloudMessage.text?.body ||
      cloudMessage.button?.text ||
      cloudMessage.interactive?.button_reply?.title ||
      cloudMessage.interactive?.button_reply?.id ||
      cloudMessage.interactive?.list_reply?.title;
    return { phone: cloudMessage.from, text };
  }

  // Formato 360Dialog direto (messages[] no raiz)
  const directMessage = body?.messages?.[0];
  if (directMessage) {
    const text =
      directMessage.text?.body ||
      directMessage.button?.payload ||
      directMessage.interactive?.button_reply?.id ||
      directMessage.interactive?.button_reply?.title;
    return { phone: directMessage.from, text };
  }

  // Formato Duotalk Templates (webhook de resposta de campanha com botão)
  // Campos confirmados pelo payload real: telefone, buttonPayload, buttonText
  if (body.telefone) {
    return {
      phone: body.telefone,
      text: body.buttonPayload || body.buttonText || body.message || body.text,
    };
  }

  // Genérico
  const duotalkPhone = body.phone || body.from || body.sender || body.contact?.phone || body.contact?.wa_id;
  const duotalkText = body.message || body.text || body.body || body.response || body.button_response?.text || body.button_response?.payload;
  return { phone: duotalkPhone, text: duotalkText };
}

router.post("/whatsapp", async (req, res) => {
  // Responde rápido — o provedor espera 200 OK em pouco tempo.
  try {
    if (env.whatsappWebhookSecret || env.whatsappWebhookSecret2) {
      const provided = req.query?.secret || req.headers["x-webhook-secret"];
      const valid =
        (env.whatsappWebhookSecret  && provided === env.whatsappWebhookSecret) ||
        (env.whatsappWebhookSecret2 && provided === env.whatsappWebhookSecret2);
      if (!valid) {
        return res.status(401).json({ ok: false, message: "Webhook secret inválido." });
      }
    }

    const { phone, text } = extractPhoneAndText(req.body);
    console.log(`[WEBHOOK-WHATSAPP] payload recebido: ${JSON.stringify(req.body)}`);

    if (!phone) {
      console.warn("[WEBHOOK-WHATSAPP] Não foi possível extrair telefone do payload.");
      return res.status(200).json({ ok: true, handled: false, reason: "Telefone não encontrado no payload." });
    }

    // Detecta se a resposta veio do template de confirmação de voucher (motorista).
    // O Duotalk inclui "intencao" e "templateTitle" no payload para identificar o template.
    // Quando é "Recebimento", a resposta pertence ao fluxo de voucher — não ao opt-in de supervisor.
    const intencao = String(req.body?.intencao || req.body?.operador || '');
    const isVoucherFlow = /recebimento/i.test(intencao) ||
      /recebimento/i.test(String(req.body?.templateTitle || '')) ||
      /tp_recebimento/i.test(String(req.body?.templateName || ''));

    if (!isVoucherFlow) {
      // Tenta primeiro como resposta de opt-in de supervisor.
      const supervisorResult = processarRespostaSupervisor({ phone, text });
      if (supervisorResult.handled) {
        return res.status(200).json({ ok: true, ...supervisorResult });
      }
    }

    // Processa como resposta de motorista (voucher/confirmação).
    const result = await processIncomingWhatsAppReply({ phone, text });
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("[WEBHOOK-WHATSAPP] Erro ao processar webhook:", error?.message || error);
    // Ainda assim retorna 200 para evitar reentrega agressiva do provedor.
    return res.status(200).json({ ok: false, message: error?.message || String(error) });
  }
});

export default router;