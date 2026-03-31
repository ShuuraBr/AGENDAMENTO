# Ajustes aplicados

## Corrigido
- `package.json` da raiz atualizado para iniciar por `backend/src/server.js`.
- `prisma` movido para `dependencies`.
- Dependências ausentes adicionadas: `zod` e `pdfkit`.
- `server.js` da raiz reduzido para um shim simples.

## Removido por redundância
- `backend/src/modules/` inteiro (não era usado pelo `app.js` ativo).
- `backend/src/middlewares/error-handler.js` (duplicado de `errorHandler.js`).
- `backend/src/services/emailService.js`
- `backend/src/services/voucherService.js`
- `backend/src/services/whatsAppService.js`
- `backend/ecosystem.config.js` (duplicado do `.cjs`).
- `node_modules/`, `backend/node_modules/`, `.git`, locks antigos e `backend/.env`.

## Deploy recomendado na Hostinger
- **Entry file:** `backend/src/server.js`
- **Root directory:** `./`
- Não enviar `node_modules` nem `.env` no ZIP.
- Manter as variáveis no painel da Hostinger.
