import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await prisma.usuario.findUnique({ include: { perfil: true }, where: { email } });

  if (!user) return res.status(401).json({ message: 'Credenciais inválidas' });

  const ok = await bcrypt.compare(password, user.senhaHash);
  if (!ok) return res.status(401).json({ message: 'Credenciais inválidas' });

  const token = jwt.sign(
    { sub: user.id, email: user.email, perfil: user.perfil.nome, nome: user.nome },
    env.jwtSecret,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil.nome } });
}

export async function me(req, res) {
  const user = await prisma.usuario.findUnique({
    where: { id: Number(req.user.sub) },
    include: { perfil: true },
  });

  res.json({ id: user.id, nome: user.nome, email: user.email, perfil: user.perfil.nome });
}
