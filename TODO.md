# Task: Fix Prisma 503

## Progress:
- [x] Step 1: Fixed janelas/routes.js (prisma.janelaAgendamento -> prisma.janela)

## Remaining:
- [ ] Step 2: Add JSON fallback to public.js
- [ ] Step 3: cd backend && npx prisma generate
- [ ] Step 4: cd backend && npx prisma db push
- [ ] Step 5: pm2 restart ecosystem.config.js
- [ ] Step 6: Test http://localhost:3000 (no 503)
