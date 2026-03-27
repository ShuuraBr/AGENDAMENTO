# Deploy Hostinger

## Root
backend

## Entry file
src/server.js

## Variáveis mínimas
PORT=3000
FRONTEND_URL=https://agendamento.objetivaatacadista.com.br
JWT_SECRET=troque_essa_chave
DATABASE_URL=mysql://usuario:senha@host:3306/banco

## Comandos
```bash
cd backend
npm install
npx prisma generate
npx prisma db push
node prisma/seed.js
npm start
```

## Observação
Se a senha do MySQL tiver `@`, use `%40` no DATABASE_URL.
