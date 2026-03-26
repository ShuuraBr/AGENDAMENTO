# Deploy GitHub -> Hostinger

## Estratégia recomendada

1. Subir o repositório no GitHub.
2. Configurar a branch `main` como produção.
3. Criar a aplicação Node.js na Hostinger para o backend.
4. Configurar o build do frontend separadamente e publicar o conteúdo de `frontend/dist`.
5. Definir variáveis de ambiente no painel da Hostinger.
6. Rodar `npx prisma migrate deploy` após publicar o backend.

## Backend

Comando de instalação:

```bash
npm install
npx prisma generate
npx prisma migrate deploy
```

Comando de inicialização:

```bash
npm start
```

## Frontend

Comando de build:

```bash
npm install && npm run build
```

Publicar o conteúdo de `frontend/dist` no domínio principal ou subdomínio.

## Variáveis críticas

- `DATABASE_URL`
- `JWT_SECRET`
- `APP_BASE_URL`
- `SMTP_HOST`
- `SMTP_USER`
- `SMTP_PASS`
- `WHATSAPP_PROVIDER`
- `WHATSAPP_API_URL`
- `WHATSAPP_TOKEN`

## Observação

Para a Hostinger, o backend deve ter porta definida por `process.env.PORT`.
