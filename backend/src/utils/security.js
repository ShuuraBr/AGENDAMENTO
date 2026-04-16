import jwt from "jsonwebtoken";
import crypto from "crypto";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET não está definido. Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor."
    );
  }
  return secret;
}

export function signInternalSession(payload) {
  return jwt.sign(
    payload,
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );
}

export function verifyInternalSession(token) {
  return jwt.verify(token, getJwtSecret());
}

export function generateProtocol() {
  return `AGD-${Date.now()}`;
}

export function generatePublicToken(prefix = "PUB", seed = "") {
  const clean = String(seed || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const base = clean || Date.now().toString();
  const random = crypto.randomBytes(6).toString("hex").toUpperCase();
  return `${prefix}-${base}-${random}`;
}
