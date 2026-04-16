import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function signInternalSession(payload) {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

export function verifyInternalSession(token) {
  return jwt.verify(token, env.jwtSecret);
}

export function generateProtocol() {
  return `AGD-${Date.now()}`;
}

export function generatePublicToken(prefix = "PUB", seed = "") {
  const clean = String(seed || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 16);
  const base = clean || Date.now().toString();
  const random = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `${prefix}-${base}-${random}`;
}
