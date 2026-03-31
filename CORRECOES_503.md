# Correções aplicadas para o erro 503

## Ajustes feitos
- Corrigido o `package.json` da raiz para gerar o Prisma Client a partir da pasta correta.
- Adicionados scripts explícitos para Prisma:
  - `npm run prisma:generate`
  - `npm run prisma:push`
  - `npm run prisma:seed`
- Movido `prisma` para `dependencies` para reduzir risco de falha em hospedagens que instalam apenas dependências de produção.
- Corrigida a documentação de deploy para usar a pasta raiz do projeto, e não `backend`.
- Adicionado `ecosystem.config.cjs` na raiz apontando para `server.js`.

## Causa provável do 503
Neste projeto, o 503 tende a acontecer quando o processo Node não sobe. O motivo mais provável é:
- Prisma Client não gerado;
- deploy iniciado na pasta errada;
- dependências copiadas do Windows para Linux.

## Como subir no servidor
```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run prisma:seed
npm start
```

## O que não enviar no zip para produção
- `node_modules/`
- `backend/node_modules/`
- `.git/`
- logs antigos
