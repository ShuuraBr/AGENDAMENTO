import jwt from "jsonwebtoken";
import crypto from "crypto";

export function signInternalSession(payload) {
  return jwt.sign(
    payload,
    process.env.JWT_SECRET || "troque_essa_chave_forte",
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

export function verifyInternalSession(token) {
  return jwt.verify(token, process.env.JWT_SECRET || "troque_essa_chave_forte");
}

export function generateProtocol() {
  return `AGD-${Date.now()}`;
}

export function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function generatePublicToken(prefix = "PUB") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}


export function normalizeCpf(value = "") {
  return String(value || "").replace(/\D/g, "").trim();
}

export function generateCpfBasedMotoristaToken(cpf = "") {
  const normalized = normalizeCpf(cpf);
  if (!normalized || normalized.length !== 11) return generatePublicToken("MOT");
  const hash = crypto.createHash("sha256").update(`${normalized}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 10).toUpperCase();
  return `MOT-${normalized}-${hash}`;
}
