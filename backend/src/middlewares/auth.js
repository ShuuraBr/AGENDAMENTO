import { verifyInternalSession } from "../utils/security.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token não informado." });
  try {
    req.user = verifyInternalSession(token);
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida." });
  }
}
