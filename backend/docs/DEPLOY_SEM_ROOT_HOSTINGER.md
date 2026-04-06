# Deploy sem root

Este pacote foi preparado para hospedagem em que **não existe configuração de root directory**.

## Estrutura esperada
- package.json na raiz
- server.js na raiz
- backend/ com código, schema Prisma e frontend estático

## Como subir
1. Envie o projeto inteiro mantendo a raiz como está.
2. Não envie `backend/node_modules` do Windows para produção Linux.
3. Execute os comandos na **raiz do projeto**:

```bash
npm install
npm run prisma:generate
npm run prisma:push
node backend/prisma/seed.js
npm start
```

## Arquivo de entrada
Use `server.js` na raiz.

## Variáveis mínimas
```
PORT=3000
FRONTEND_URL=https://SEU-DOMINIO
JWT_SECRET=troque_essa_chave
DATABASE_URL=mysql://usuario:senha@host:3306/banco
```

## Se já existir base criada
Rode antes o arquivo `docs/ALTERS_V3_SEM_ROOT.sql` para adicionar as colunas que faltavam na tabela `Agendamento`.

## Motivos corrigidos aqui
- rota criava agendamento com campos que não existiam na tabela
- notas fiscais nem sempre eram persistidas junto do agendamento
- pacote continha engine Prisma de Windows dentro de `backend/node_modules`, o que pode causar 503 em Linux
- carregamento de `.env` agora procura tanto na raiz quanto em `backend/.env`
