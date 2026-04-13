# Prisma / MySQL modo duplo

## Objetivo
- evitar panic em rotas críticas;
- usar MySQL direto (`mysql2`) em login, cadastros e auditoria;
- manter Prisma apenas fora da rota crítica;
- desativar watcher automático do relatório no boot.

## Variáveis úteis
- `RELATORIO_IMPORT_WATCHER=0` -> desliga watcher no boot.
- `PRISMA_DISABLED=1` -> impede tentativa de uso do Prisma.
- `MYSQL_DIRECT_DISABLED=1` -> desliga o MySQL direto e força arquivo.

## Fluxo esperado
1. login e cadastros tentam MySQL direto;
2. se MySQL direto falhar, usam arquivo JSON;
3. Prisma não é mais o caminho principal dessas rotas.
