import { verifyInternalSession } from "../utils/security.js";
import { hasAnyPermission, hasPermission, normalizeProfile } from "../utils/permissions.js";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "Token não informado." });
  try {
    req.user = verifyInternalSession(token);
    req.user.perfil = normalizeProfile(req.user?.perfil);
    req.user.permissions = req.user.permissions || [];
    next();
  } catch {
    return res.status(401).json({ message: "Sessão inválida." });
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


export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user || !hasPermission(req.user.perfil, permission)) {
      return res.status(403).json({ message: "Perfil sem permissão para esta ação.", permission });
    }
    next();
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user || !hasAnyPermission(req.user.perfil, permissions)) {
      return res.status(403).json({ message: "Perfil sem permissão para esta ação.", permissions });
    }
    next();
  };
}
