# Deploy GitHub -> Hostinger

## Estratégia recomendada

- Repositório único no GitHub
- Backend Node.js publicado na Hostinger
- Frontend Vite com build estático
- Banco MySQL da própria Hostinger

## Passos

1. Suba este repositório para o GitHub.
2. Crie o banco MySQL na Hostinger.
3. Ajuste o `.env` do backend com:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `SMTP_*`
4. No backend:
   - `npm install`
   - `npx prisma generate`
   - `npx prisma db push`
   - `node prisma/seed.js`
5. No frontend:
   - ajuste `VITE_API_URL`
   - `npm install`
   - `npm run build`
6. Publique o backend como app Node.js.
7. Publique o build do frontend no domínio/subdomínio desejado.

## Observação

Se quiser simplificar o primeiro deploy, você pode servir o frontend buildado a partir do próprio backend. Nesta base, frontend e backend estão separados para facilitar manutenção.
