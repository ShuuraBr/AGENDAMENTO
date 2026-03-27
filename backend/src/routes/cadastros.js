import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";

const router = Router();
router.use(authRequired);

const models = {
  fornecedores: "fornecedor",
  transportadoras: "transportadora",
  motoristas: "motorista",
  veiculos: "veiculo",
  docas: "doca",
  janelas: "janela",
  regras: "regra"
};

function model(tipo) { return models[tipo]; }

router.get("/:tipo", async (req, res) => {
  const m = model(req.params.tipo);
  if (!m) return res.status(400).json({ message: "Tipo inválido." });
  res.json(await prisma[m].findMany({ orderBy: { id: "desc" } }));
});

router.post("/:tipo", async (req, res) => {
  const m = model(req.params.tipo);
  if (!m) return res.status(400).json({ message: "Tipo inválido." });
  res.status(201).json(await prisma[m].create({ data: req.body }));
});

router.put("/:tipo/:id", async (req, res) => {
  const m = model(req.params.tipo);
  if (!m) return res.status(400).json({ message: "Tipo inválido." });
  res.json(await prisma[m].update({ where: { id: Number(req.params.id) }, data: req.body }));
});

export default router;
