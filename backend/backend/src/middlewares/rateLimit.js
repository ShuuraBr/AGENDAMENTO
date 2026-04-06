import { prisma } from "../utils/prisma.js";
import { auditLog } from "../utils/audit.js";

const bucket = new Map();

function keyFor(req, email = "") {
  return `${req.ip}|${String(email).toLowerCase()}`;
}

function now() {
  return Date.now();
}

export async function loginRateLimit(req, res, next) {
  const email = req.body?.email || "";
  const key = keyFor(req, email);
  const item = bucket.get(key);

  if (item && item.blockedUntil && item.blockedUntil > now()) {
    const retryIn = Math.ceil((item.blockedUntil - now()) / 1000);
    await auditLog({
      usuarioId: null,
      perfil: null,
      acao: "LOGIN_BLOCKED",
      entidade: "AUTH",
      entidadeId: null,
      detalhes: { email, retryIn },
      ip: req.ip
    });
    return res.status(429).json({ message: `Acesso temporariamente bloqueado. Tente novamente em ${retryIn}s.` });
  }

  req.loginRateKey = key;
  next();
}

export async function registerLoginFailure(req, email) {
  const key = keyFor(req, email);
  const item = bucket.get(key) || { failures: 0, firstFailureAt: now(), blockedUntil: 0 };

  // Janela de 15 minutos
  if (now() - item.firstFailureAt > 15 * 60 * 1000) {
    item.failures = 0;
    item.firstFailureAt = now();
    item.blockedUntil = 0;
  }

  item.failures += 1;

  // Bloqueio progressivo
  if (item.failures >= 5) {
    item.blockedUntil = now() + 15 * 60 * 1000;
  }

  bucket.set(key, item);

  await auditLog({
    usuarioId: null,
    perfil: null,
    acao: "LOGIN_FAILURE",
    entidade: "AUTH",
    entidadeId: null,
    detalhes: { email, failures: item.failures, blockedUntil: item.blockedUntil || null },
    ip: req.ip
  });
}

export async function clearLoginFailures(req, email, user) {
  const key = keyFor(req, email);
  bucket.delete(key);

  await auditLog({
    usuarioId: user?.id || null,
    perfil: user?.perfil || null,
    acao: "LOGIN_SUCCESS",
    entidade: "AUTH",
    entidadeId: user?.id || null,
    detalhes: { email },
    ip: req.ip
  });
}
