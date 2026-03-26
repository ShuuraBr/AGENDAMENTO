import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Token não informado." });

  try {
    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido." });
  }
}

export function requireProfiles(...profiles) {
  return (req, res, next) => {
    if (!req.user || !profiles.includes(req.user.role)) {
      return res.status(403).json({ message: "Acesso negado." });
    }
    next();
  };
}
