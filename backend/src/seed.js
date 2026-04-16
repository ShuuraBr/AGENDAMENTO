import crypto from 'crypto';
import { prisma } from './config/prisma.js';
import { hashPassword } from './utils/password.js';

async function main() {
  const seedPassword = process.env.SEED_ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');

  const perfilAdmin = await prisma.perfil.upsert({
    where: { nome: 'ADMIN' },
    update: {},
    create: { nome: 'ADMIN', descricao: 'Administrador do sistema' },
  });

  await prisma.usuario.upsert({
    where: { email: 'admin@local.com' },
    update: {},
    create: {
      nome: 'Administrador',
      email: 'admin@local.com',
      senhaHash: await hashPassword(seedPassword),
      perfilId: perfilAdmin.id,
      status: 'ATIVO',
    },
  });

  console.log(`Seed concluído. Usuário: admin@local.com`);
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.log(`[SECURITY] Generated random password: ${seedPassword}`);
    console.log('[SECURITY] Set SEED_ADMIN_PASSWORD env var to use a fixed password.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });