import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { readCollection } from "../utils/store.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) {
    return res.status(400).json({ message: "Email e senha são obrigatórios." });
  }

  const usuarios = readCollection("usuarios");
  const user = usuarios.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user) return res.status(401).json({ message: "Credenciais inválidas." });

  let ok = false;
  if (user.senhaHash) {
    ok = await bcrypt.compare(senha, user.senhaHash);
  } else if (user.senha) {
    ok = user.senha === senha;
  }

  if (!ok) return res.status(401).json({ message: "Credenciais inválidas." });

  const token = jwt.sign(
    { sub: user.id, nome: user.nome, perfil: user.perfil },
    process.env.JWT_SECRET || "troque_essa_chave",
    { expiresIn: "8h" }
  );

  res.json({
    token,
    user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil }
  });
});

export default router;
