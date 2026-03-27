import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import { fetchUserByEmail } from "../utils/db-fallback.js";
import { signInternalSession } from "../utils/security.js";
import { auditLog } from "../utils/audit.js";
import { loginRateLimit, registerLoginFailure, clearLoginFailures } from "../middlewares/rateLimit.js";

const router = Router();

async function findUserByEmail(email) {
  try {
    return await prisma.usuario.findUnique({ where: { email } });
  } catch (ormError) {
    console.error("Prisma ORM falhou em /auth/login. Tentando fallback SQL:", ormError?.message || ormError);
    return fetchUserByEmail(email);
  }
}

router.post("/login", loginRateLimit, async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
      return res.status(400).json({ message: "Email e senha são obrigatórios." });
    }

    const user = await findUserByEmail(String(email).trim());

    if (!user) {
      await registerLoginFailure(req, email);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) {
      await registerLoginFailure(req, email);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const token = signInternalSession({
      sub: user.id,
      nome: user.nome,
      perfil: user.perfil
    });

    await clearLoginFailures(req, email, user);

    await auditLog({
      usuarioId: user.id,
      perfil: user.perfil,
      acao: "LOGIN",
      entidade: "USUARIO",
      entidadeId: user.id,
      detalhes: { email: user.email },
      ip: req.ip
    });

    return res.json({
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        perfil: user.perfil
      }
    });
  } catch (err) {
    console.error("Erro no login:", err);
    return res.status(500).json({
      message: "Erro interno no login.",
      error: err?.message || "Falha não identificada"
    });
  }
});

export default router;
