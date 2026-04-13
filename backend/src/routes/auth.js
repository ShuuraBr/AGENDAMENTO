import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma, isPrismaDisabled } from "../utils/prisma.js";
import { fetchUserByEmail } from "../utils/db-fallback.js";
import { readUsuarios } from "../utils/file-store.js";
import { signInternalSession } from "../utils/security.js";
import { auditLog } from "../utils/audit.js";
import { loginRateLimit, registerLoginFailure, clearLoginFailures } from "../middlewares/rateLimit.js";
import { getAccessProfileSummary, normalizeProfile } from "../utils/permissions.js";

const router = Router();

async function findUserByEmail(email) {
  try {
    return await prisma.usuario.findUnique({ where: { email } });
  } catch (ormError) {
    console.error("Prisma ORM falhou em /auth/login. Tentando fallback SQL:", ormError?.message || ormError);
    if (!isPrismaDisabled()) {
      try {
        const dbUser = await fetchUserByEmail(email);
        if (dbUser) return dbUser;
      } catch (fallbackError) {
        console.error("Fallback SQL falhou em /auth/login. Tentando arquivo JSON:", fallbackError?.message || fallbackError);
      }
    }
    const fileUser = readUsuarios().find((item) => String(item.email || '').toLowerCase() === String(email || '').toLowerCase());
    if (!fileUser) return null;
    return {
      id: fileUser.id,
      nome: fileUser.nome,
      email: fileUser.email,
      perfil: fileUser.perfil || 'ADMIN',
      senhaHash: fileUser.senhaHash || null,
      senha: fileUser.senha || null,
    };
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

    const ok = user.senhaHash ? await bcrypt.compare(senha, user.senhaHash) : String(senha) === String(user.senha || '');
    if (!ok) {
      await registerLoginFailure(req, email);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    const access = getAccessProfileSummary(normalizeProfile(user.perfil));

    const token = signInternalSession({
      sub: user.id,
      nome: user.nome,
      perfil: access.codigo,
      permissions: access.permissoes
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
        perfil: access.codigo,
        perfilNome: access.nome,
        permissoes: access.permissoes,
        permissions: access.permissoes
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
