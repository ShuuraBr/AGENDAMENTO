import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authRequired } from "../../middlewares/auth.js";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const items = await prisma.fornecedor.findMany({ orderBy: { id: "desc" } });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const item = await prisma.fornecedor.findUnique({ where: { id: Number(req.params.id) } });
  if (!item) return res.status(404).json({ message: "Registro não encontrado." });
  res.json(item);
});

router.post("/", async (req, res) => {
  const item = await prisma.fornecedor.create({ data: req.body });
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const item = await prisma.fornecedor.update({
    where: { id: Number(req.params.id) },
    data: req.body
  });
  res.json(item);
});

export default router;
