# Arquitetura MVP - Produção

## Público externo

- `/public/agendar`: transportadora/fornecedor
- `/public/motorista/:protocolo`: consulta do voucher e confirmação do motorista

## Público interno

- `/login`
- `/dashboard`
- `/agendamentos`
- `/cadastros`

## Backend

API REST com Express, autenticação JWT, Prisma, PDFKit, Nodemailer, upload com Multer.

## Camadas

- `routes`: definição de endpoints
- `modules`: handlers e regras de negócio
- `services`: e-mail, WhatsApp, PDF, upload
- `middlewares`: auth e tratamento de erro
