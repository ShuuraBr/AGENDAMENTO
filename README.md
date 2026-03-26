# Agendamento de Descarga - Produção Unificada

Versão unificada do repositório para GitHub + Hostinger.

## Escopo consolidado nesta base

- autenticação JWT
- cadastros principais
- janelas e docas
- regras de aprovação automática/manual
- agendamento interno
- aprovação, reprovação, reagendamento e cancelamento
- upload de documentos
- voucher em PDF
- envio real de e-mail via SMTP
- estrutura preparada para WhatsApp
- painel operacional
- área pública da transportadora/fornecedor
- área pública do motorista por protocolo

## Estrutura

```text
backend/
frontend/
docs/
.github/workflows/
```

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express + Prisma
- Banco: MySQL
- Auth: JWT
- Uploads: Multer
- PDF: PDFKit
- E-mail: Nodemailer

## Rodar localmente

### 1) Backend
```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js
npm run dev
```

### 2) Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Credenciais de seed

- Usuário: `admin@local.test`
- Senha: `123456`

## Publicação na Hostinger

Veja `docs/deploy-hostinger.md`.
