import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";

const router = Router();
router.use(authRequired);

const map = {
  fornecedores: "fornecedor",
  transportadoras: "transportadora",
  motoristas: "motorista",
  veiculos: "veiculo",
  docas: "doca",
  janelas: "janela",
  regras: "regra"
};

function modelFor(tipo) {
  return map[tipo];
}

router.get("/:tipo", async (req, res) => {
  const model = modelFor(req.params.tipo);
  if (!model) return res.status(400).json({ message: "Tipo inválido." });
  const items = await prisma[model].findMany({ orderBy: { id: "desc" } });
  res.json(items);
});

router.post("/:tipo", async (req, res) => {
  const model = modelFor(req.params.tipo);
  if (!model) return res.status(400).json({ message: "Tipo inválido." });
  const item = await prisma[model].create({ data: req.body });
  res.status(201).json(item);
});

router.put("/:tipo/:id", async (req, res) => {
  const model = modelFor(req.params.tipo);
  if (!model) return res.status(400).json({ message: "Tipo inválido." });
  const item = await prisma[model].update({
    where: { id: Number(req.params.id) },
    data: req.body
  });
  res.json(item);
});

export default router;
