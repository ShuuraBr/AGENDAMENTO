# Agendamento de Descarga - MVP v2

Base de MVP para publicação no GitHub e hospedagem na Hostinger.

## O que já existe nesta versão

- autenticação JWT
- cadastros principais
- criação de agendamentos
- painel operacional do dia
- regras básicas de autoaprovação
- aprovação manual com `force=true`
- upload de documentos por agendamento
- geração de voucher em PDF
- envio simulado de voucher

## Estrutura

- `frontend/` React + Vite
- `backend/` Node.js + Express + Prisma
- `database/` schema SQL para MySQL Workbench
- `docs/` escopo do MVP

## Backend

### Variáveis de ambiente

Copie `backend/.env.example` para `.env`.

### Instalação

```bash
cd backend
npm install
npx prisma generate
npm run dev
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

## Fluxos principais entregues

1. Login
2. Cadastro base
3. Criação de agendamento com prévia de aprovação
4. Aprovação manual
5. Check-in
6. Início e finalização de descarga
7. Upload de documentos
8. Geração de voucher PDF

## Pendências naturais da próxima etapa

- envio real de e-mail
- envio real de WhatsApp
- validação documental no painel
- área pública para motorista e transportadora
- trilha de auditoria automática
- integração com Hostinger/GitHub em produção
