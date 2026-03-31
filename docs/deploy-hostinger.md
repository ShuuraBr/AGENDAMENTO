# Deploy Hostinger

## Root da aplicação
A raiz da aplicação Node.js deve ser a pasta principal do projeto, a mesma que contém:
- `package.json`
- `server.js`
- pasta `backend/`

Não configure `backend` como root da aplicação.

## Entry file
`server.js`

## Variáveis mínimas
```env
PORT=3000
FRONTEND_URL=https://agendamento.objetivaatacadista.com.br
JWT_SECRET=troque_essa_chave
DATABASE_URL=mysql://usuario:senha@host:3306/banco
```

## Observação sobre DATABASE_URL
Se a senha do MySQL tiver caracteres especiais como `@`, `:`, `/` ou espaço, use a versão codificada na URL.

Exemplo:
- senha original: `minha@senha`
- senha na URL: `minha%40senha`

## Estrutura correta de deploy
Envie o projeto sem `node_modules` e sem logs antigos. O servidor deve instalar as dependências no ambiente Linux.

Arquivos e pastas que devem subir:
- `package.json`
- `package-lock.json`
- `server.js`
- `backend/`
- `docs/`
- `database/`
- `shared/`

Arquivos e pastas que não devem subir:
- `node_modules/`
- `backend/node_modules/`
- `backend/logs/`
- `.git/`

## Comandos
```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm start
```

## Diagnóstico do erro 503
Se o Hostinger retornar `503`, verifique primeiro estes pontos:
1. a aplicação está usando a pasta raiz correta;
2. o `npm install` concluiu sem falhas;
3. o Prisma Client foi gerado com `npm run prisma:generate`;
4. o `DATABASE_URL` está válido;
5. o processo Node conseguiu subir sem erro no log.

O erro mais comum neste projeto é o processo morrer no boot porque o Prisma Client não foi gerado.
