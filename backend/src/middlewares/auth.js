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

export function getOptionalUserFromRequest(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    return verifyInternalSession(token);
  } catch {
    return null;
  }
}

export function requireProfiles(...profiles) {
  return (req, res, next) => {
    if (!req.user || !profiles.includes(req.user.perfil)) {
      return res.status(403).json({ message: "Perfil sem permissão para esta ação." });
    }
    next();
  };
}
