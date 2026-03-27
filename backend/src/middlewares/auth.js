import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Token não informado." });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || "troque_essa_chave");
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido." });
  }
}
