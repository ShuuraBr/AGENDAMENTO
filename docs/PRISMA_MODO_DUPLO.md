# Prisma em modo duplo: fallback + retomada do banco

Este pacote foi preparado para operar em dois modos:

1. **Modo fallback**: se o Prisma entrar em panic (`PANIC: timer has gone away`), a aplicação desabilita o Prisma no processo e continua usando os arquivos JSON já existentes em `backend/data`.
2. **Modo banco**: quando a hospedagem estiver compatível, basta remover `PRISMA_DISABLED=1`, regenerar o client e subir normalmente.

## Variáveis recomendadas

```env
DB_HOST=...
DB_PORT=3306
DB_NAME=...
DB_USER=...
DB_PASS=...
DATABASE_URL=mysql://USER:PASS@HOST:3306/DBNAME
PRISMA_DISABLED=1
```

Use `PRISMA_DISABLED=1` enquanto o host estiver com panic do engine.

## O que mudou

- O Prisma agora é desativado permanentemente no processo após um panic do engine.
- Login, auditoria e cadastros deixam de insistir no Prisma quando ele já foi derrubado.
- O deploy não quebra mais se `prisma generate` falhar: o script de postinstall ficou tolerante.
- O schema foi preparado com `binaryTargets` para ambientes Linux comuns com OpenSSL 1.1.x e 3.0.x.

## Como tentar reativar o Prisma

No servidor, rode:

```bash
npm run prisma:env:check
npm run prisma:generate
```

Se o host aceitar o Prisma, remova `PRISMA_DISABLED=1` e reinicie a aplicação.

## Observação importante

Mesmo com `binaryTargets`, o panic ainda pode ocorrer se a hospedagem for incompatível com o engine nativo do Prisma. A documentação oficial do Prisma trata `binaryTargets` e a compatibilidade do client com o ambiente de deploy.
