# Deploy Hostinger

## Configuração
- Framework preset: Express
- Root directory: backend
- Entry file: src/server.js
- Node version: 20.x ou 22.x

## Variáveis
PORT=3000
FRONTEND_URL=https://agendamento.objetivaatacadista.com.br
JWT_SECRET=troque_essa_chave_forte
JWT_EXPIRES_IN=8h
DATABASE_URL=mysql://usuario:senha@host:3306/banco

SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@seudominio.com
SMTP_PASS=sua_senha
MAIL_FROM="Agendamento de Descarga <no-reply@seudominio.com>"

## Comandos
cd backend
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js
npm start
