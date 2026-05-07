import { Router } from "express";
import bcrypt from "bcryptjs";
import { findUserByEmailDirect, directCadastrosEnabled } from "../utils/direct-cadastros.js";
import { readUsuarios } from "../utils/file-store.js";
import { signInternalSession } from "../utils/security.js";
import { auditLog } from "../utils/audit.js";
import { loginRateLimit, registerLoginFailure, clearLoginFailures } from "../middlewares/rateLimit.js";
import { getAccessProfileSummary, normalizeProfile } from "../utils/permissions.js";
import { logOnce } from "../utils/log-once.js";
import { sendEmail, isMailConfigured } from "../services/emailService.js";

const router = Router();

// ── 2FA code store (in-memory, TTL 10 min) ──────────────────────────────────
const _2faCodes = new Map(); // key: email → { code, expiresAt, userId }
function generate2FACode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function store2FACode(email, code) {
  _2faCodes.set(email.toLowerCase(), { code, expiresAt: Date.now() + 10 * 60 * 1000 });
}
function verify2FACode(email, code) {
  const entry = _2faCodes.get(email.toLowerCase());
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { _2faCodes.delete(email.toLowerCase()); return false; }
  if (entry.code !== String(code).trim()) return false;
  _2faCodes.delete(email.toLowerCase());
  return true;
}

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

// ── Step 1: validate credentials → send 2FA code ────────────────────────────
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

    if (!user.senhaHash) {
      console.warn(`[SECURITY] User ${user.email} has no hashed password. Rejecting login.`);
      await registerLoginFailure(req, email);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }
    const ok = await bcrypt.compare(senha, user.senhaHash);
    if (!ok) {
      await registerLoginFailure(req, email);
      return res.status(401).json({ message: "Credenciais inválidas." });
    }

    // Credentials valid — send 2FA code by email if mail is configured
    if (isMailConfigured()) {
      const code = generate2FACode();
      store2FACode(user.email, code);
      try {
        await sendEmail({
          to: user.email,
          subject: 'Seu código de verificação — Agendamento',
          html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:32px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0">
            <h2 style="margin:0 0 8px;color:#0f172a">Verificação em duas etapas</h2>
            <p style="color:#475569;margin:0 0 24px">Use o código abaixo para concluir o login. Ele expira em <strong>10 minutos</strong>.</p>
            <div style="background:#fff;border:2px solid #2563eb;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
              <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#0f172a">${code}</span>
            </div>
            <p style="color:#94a3b8;font-size:12px;margin:0">Se você não solicitou este código, ignore este e-mail.</p>
          </div>`,
          text: `Seu código de verificação: ${code} (expira em 10 minutos)`
        });
      } catch (mailErr) {
        console.error('[2FA] Failed to send email:', mailErr?.message);
        // Fallback: if email fails, skip 2FA and login directly
        return completLogin(res, req, user);
      }
      return res.json({ requires2FA: true, email: user.email.replace(/(.{2}).+(@.+)/, '$1***$2') });
    }

    // Email not configured — skip 2FA
    return completLogin(res, req, user);

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
      message: "Erro interno no login."
    });
  }
});

// ── Shared: build JWT and respond after successful auth ──────────────────────
async function completLogin(res, req, user) {
  const access = getAccessProfileSummary(normalizeProfile(user.perfil));
  const token = signInternalSession({
    sub: user.id,
    nome: user.nome,
    email: user.email,
    perfil: access.codigo,
    permissions: access.permissoes
  });
  await clearLoginFailures(req, user.email, user);
  await auditLog({
    usuarioId: user.id,
    perfil: user.perfil,
    acao: "LOGIN",
    entidade: "USUARIO",
    entidadeId: user.id,
    detalhes: { email: user.email, via: "2fa" },
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
}

// ── Step 2: verify 2FA code ──────────────────────────────────────────────────
router.post("/verify-2fa", loginRateLimit, async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) return res.status(400).json({ message: "Email e código são obrigatórios." });
    const valid = verify2FACode(String(email).trim(), String(code).trim());
    if (!valid) return res.status(401).json({ message: "Código inválido ou expirado." });
    const user = await findUserByEmail(String(email).trim());
    if (!user) return res.status(401).json({ message: "Usuário não encontrado." });
    return completLogin(res, req, user);
  } catch (err) {
    console.error("Erro no verify-2fa:", err);
    return res.status(500).json({ message: "Erro interno." });
  }
});

export default router;
