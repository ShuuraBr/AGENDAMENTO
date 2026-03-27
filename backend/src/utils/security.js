import jwt from "jsonwebtoken";

export function signInternalSession(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || "troque_essa_chave_forte", { expiresIn: "8h" });
}
export function verifyInternalSession(token) {
  return jwt.verify(token, process.env.JWT_SECRET || "troque_essa_chave_forte");
}
export function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
export function generateProtocol() {
  return `AGD-${Date.now()}`;
}
export function generatePublicToken(prefix = "PUB") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
