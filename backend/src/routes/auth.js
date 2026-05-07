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
          subject: 'Código de verificação — Agendamento',
          html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#1a1a2a;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a2a;padding:40px 20px;">
  <tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="background:#22223a;border-radius:12px;overflow:hidden;max-width:480px;width:100%;">
      <tr>
        <td style="padding:32px 40px 20px;text-align:center;">
          <div style="font-size:28px;margin-bottom:8px;">🔒</div>
          <div style="color:#a0a0b8;font-size:13px;letter-spacing:0.5px;">Agendamento · Objetiva Atacadista</div>
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 28px;">
          <p style="color:#e8e8f0;font-size:16px;margin:0 0 8px;">Olá, <strong>${user.nome}</strong>!</p>
          <p style="color:#a0a0b8;font-size:14px;margin:0 0 24px;">Use o código abaixo para concluir sua verificação em dois fatores.</p>
          <div style="border:2px dashed #444466;border-radius:10px;padding:4px;">
            <div style="background:#14142a;border-radius:8px;padding:20px;text-align:center;">
              <div style="color:#a0a0b8;font-size:10px;letter-spacing:3px;margin-bottom:12px;">CÓDIGO DE VERIFICAÇÃO</div>
              <div style="color:#ffffff;font-size:40px;font-weight:700;letter-spacing:14px;font-family:monospace;">${code}</div>
            </div>
          </div>
          <div style="background:#b8860b;border-radius:8px;padding:12px 16px;margin-top:20px;">
            <span style="color:#fff8e0;font-size:13px;">🔒 Válido por <strong>10 minutos</strong>. Não compartilhe com ninguém.</span>
          </div>
          <p style="color:#6b6b88;font-size:12px;margin:16px 0 0;">Se você não tentou acessar o sistema, ignore este e-mail.</p>
        </td>
      </tr>
      <tr>
        <td style="border-top:1px solid #2e2e4a;padding:16px 40px;text-align:center;">
          <span style="color:#505070;font-size:11px;">Agendamento · Objetiva Atacadista · Uso interno e restrito</span>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body></html>`,
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
