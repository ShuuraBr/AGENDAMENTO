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

export function generatePublicToken(prefix = "PUB", seed = "") {
  const clean = String(seed || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const base = clean || Date.now().toString();
  return `${prefix}-${base}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}
