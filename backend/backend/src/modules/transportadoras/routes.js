import { Router } from "express";
import { prisma } from "../../config/prisma.js";
import { authRequired } from "../../middlewares/auth.js";

const router = Router();
router.use(authRequired);

router.get("/", async (_req, res) => {
  const items = await prisma.transportadora.findMany({ orderBy: { id: "desc" } });
  res.json(items);
});

router.get("/:id", async (req, res) => {
  const item = await prisma.transportadora.findUnique({ where: { id: Number(req.params.id) } });
  if (!item) return res.status(404).json({ message: "Registro não encontrado." });
  res.json(item);
});

router.post("/", async (req, res) => {
  const item = await prisma.transportadora.create({ data: req.body });
  res.status(201).json(item);
});

router.put("/:id", async (req, res) => {
  const item = await prisma.transportadora.update({
    where: { id: Number(req.params.id) },
    data: req.body
  });
  res.json(item);
});

export default router;
