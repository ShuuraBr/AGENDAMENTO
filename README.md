# Agendamento de Descarga - MVP

Monorepo inicial do MVP real da aplicação de agendamento de descarga, preparado para GitHub e hospedagem na Hostinger.

## Escopo do MVP
- Autenticação com JWT
- Cadastros básicos
- Agendamentos
- Painel operacional

## Estrutura
```text
backend/   API Node.js + Express + Prisma + JWT
frontend/  React + Vite
database/  SQL base do MySQL Workbench
docs/      documentação do MVP
```

## Como rodar
### Banco
Importe `database/schema_agendamento_descarga_mysql.sql`.

### Backend
```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
node src/seed.js
npm run dev
```

### Frontend
```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```
