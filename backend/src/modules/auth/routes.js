import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";
import { env } from "../../config/env.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ message: "Email e senha são obrigatórios." });

  const user = await prisma.usuario.findUnique({ where: { email }, include: { perfil: true } });
  if (!user) return res.status(401).json({ message: "Credenciais inválidas." });

  const ok = await bcrypt.compare(senha, user.senhaHash);
  if (!ok) return res.status(401).json({ message: "Credenciais inválidas." });

  const token = jwt.sign(
    { sub: user.id, name: user.nome, role: user.perfil.nome },
    env.jwtSecret,
    { expiresIn: "8h" }
  );

  res.json({ token, user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil.nome } });
});

export default router;
