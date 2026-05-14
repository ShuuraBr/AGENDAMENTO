import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { listNotificacoes, markLida, findNotificacao, deleteNotificacao } from "../utils/notifications.js";

const router = Router();
router.use(authRequired);

// GET /notificacoes — lista notificações para o perfil do usuário logado
router.get("/", (req, res) => {
  try {
    const perfil = req.user?.perfil;
    const usuarioId = String(req.user?.sub || '');
    const all = listNotificacoes({ perfil });
    const withLida = all.map((n) => ({
      ...n,
      lida: Array.isArray(n.lidaPor) && n.lidaPor.includes(usuarioId)
    }));
    res.json(withLida);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /notificacoes/:id/lida — marcar como lida
router.patch("/:id/lida", (req, res) => {
  try {
    const usuarioId = String(req.user?.sub || '');
    const updated = markLida(req.params.id, usuarioId);
    if (!updated) return res.status(404).json({ message: "Notificação não encontrada." });
    res.json({ ...updated, lida: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE /notificacoes/:id — remover (admin/gestor)
router.delete("/:id", (req, res) => {
  try {
    const perfil = req.user?.perfil;
    if (!['ADMIN', 'GESTOR'].includes(perfil)) return res.status(403).json({ message: "Sem permissão." });
    deleteNotificacao(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;
