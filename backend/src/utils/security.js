import jwt from "jsonwebtoken";

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

export function generateDriverToken(cpf) {
  const digits = onlyDigits(cpf);
  const base = digits || `SEMCPF${String(Date.now()).slice(-6)}`;
  return `MOT-${base}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}
