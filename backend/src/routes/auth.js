import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import { generateOtp, signInternalSession } from "../utils/security.js";
import { sendMail } from "../utils/email.js";

const router = Router();

router.post("/login-init", async (req, res) => {
  const { email, senha } = req.body || {};
  if (!email || !senha) return res.status(400).json({ message: "Email e senha são obrigatórios." });

  const user = await prisma.usuario.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ message: "Credenciais inválidas." });

  const ok = await bcrypt.compare(senha, user.senhaHash);
  if (!ok) return res.status(401).json({ message: "Credenciais inválidas." });

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await prisma.twoFactorCode.create({
    data: { usuarioId: user.id, code: otp, expiresAt }
  });

  const sent = await sendMail({
    to: user.email,
    subject: "Seu código de acesso",
    text: `Seu código é ${otp}. Expira em 10 minutos.`,
    html: `<p>Seu código é <strong>${otp}</strong>. Expira em 10 minutos.</p>`
  });

  res.json({
    ok: true,
    message: sent.sent ? "Código enviado por e-mail." : "SMTP não configurado. Código gerado em desenvolvimento.",
    developmentCode: sent.sent ? undefined : otp
  });
});

router.post("/login-verify", async (req, res) => {
  const { email, code } = req.body || {};
  if (!email || !code) return res.status(400).json({ message: "Email e código são obrigatórios." });

  const user = await prisma.usuario.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ message: "Usuário inválido." });

  const factor = await prisma.twoFactorCode.findFirst({
    where: {
      usuarioId: user.id,
      code,
      usedAt: null,
      expiresAt: { gt: new Date() }
    },
    orderBy: { id: "desc" }
  });

  if (!factor) return res.status(401).json({ message: "Código inválido ou expirado." });

  await prisma.twoFactorCode.update({
    where: { id: factor.id },
    data: { usedAt: new Date() }
  });

  const token = signInternalSession({
    sub: user.id,
    nome: user.nome,
    perfil: user.perfil
  });

  res.json({
    token,
    user: { id: user.id, nome: user.nome, email: user.email, perfil: user.perfil }
  });
});

export default router;
