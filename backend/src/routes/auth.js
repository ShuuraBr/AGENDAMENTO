import { Router } from "express";
import bcrypt from "bcryptjs";
import { findUserByEmailDirect, directCadastrosEnabled } from "../utils/direct-cadastros.js";
import { readUsuarios } from "../utils/file-store.js";
import { signInternalSession } from "../utils/security.js";
import { auditLog } from "../utils/audit.js";
import { loginRateLimit, registerLoginFailure, clearLoginFailures } from "../middlewares/rateLimit.js";
import { getAccessProfileSummary, normalizeProfile } from "../utils/permissions.js";
import { logOnce } from "../utils/log-once.js";

const router = Router();

async function findUserByEmail(email) {
  if (directCadastrosEnabled()) {
    try {
      const dbUser = await findUserByEmailDirect(email);
      if (dbUser) return dbUser;
    } catch (dbError) {
      logOnce('auth-login-direct-db', 'Login operando sem MySQL direto. Usando arquivo local:', dbError?.message || dbError);
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
