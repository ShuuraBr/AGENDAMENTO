import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authRequired } from "../../middlewares/auth.js";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const items = await prisma.janela.findMany({ orderBy: { id: "desc" } });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "ID de janela inválido." });
  }

  const item = await prisma.janela.findFirst({ where: { id } });
  if (!item) return res.status(404).json({ message: "Registro não encontrado." });
  res.json(item);
});

router.post("/", async (req, res) => {
  const item = await prisma.janela.create({ data: req.body });
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "ID de janela inválido." });
  }

  const item = await prisma.janela.update({
    where: { id },
    data: req.body
  });
  res.json(item);
});

export default router;
