import crypto from 'crypto';
import { prisma } from './config/prisma.js';
import { hashPassword } from './utils/password.js';

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@local.com';
  const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(16).toString('hex');

  const perfilAdmin = await prisma.perfil.upsert({
    where: { nome: 'ADMIN' },
    update: {},
    create: { nome: 'ADMIN', descricao: 'Administrador do sistema' }
  });

  await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      nome: 'Administrador',
      email: adminEmail,
      senhaHash: await hashPassword(adminPassword),
      perfilId: perfilAdmin.id,
      status: 'ATIVO'
    }
  });

  console.log(`Seed concluído. Usuário: ${adminEmail}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Senha gerada automaticamente: ${adminPassword}`);
    console.log('Defina ADMIN_PASSWORD como variável de ambiente para usar uma senha fixa.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
