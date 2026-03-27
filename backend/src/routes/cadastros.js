import { Router } from "express";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { validateProfile } from "../utils/validators.js";

const router = Router();
router.use(authRequired);

const models = {
  fornecedores: "fornecedor",
  transportadoras: "transportadora",
  motoristas: "motorista",
  veiculos: "veiculo",
  docas: "doca",
  janelas: "janela",
  regras: "regra",
  usuarios: "usuario"
};

function model(tipo) { return models[tipo]; }

router.get("/:tipo", async (req, res) => {
  const m = model(req.params.tipo);
  if (!m) return res.status(400).json({ message: "Tipo inválido." });
  res.json(await prisma[m].findMany({ orderBy: { id: "desc" } }));
});

router.post("/:tipo", requireProfiles("ADMIN", "GESTOR"), async (req, res) => {
  try {
    const m = model(req.params.tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });
    if (req.params.tipo === "usuarios") validateProfile(req.body?.perfil);
    res.status(201).json(await prisma[m].create({ data: req.body }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:tipo/:id", requireProfiles("ADMIN", "GESTOR"), async (req, res) => {
  try {
    const m = model(req.params.tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });
    if (req.params.tipo === "usuarios" && req.body?.perfil) validateProfile(req.body.perfil);
    res.json(await prisma[m].update({ where: { id: Number(req.params.id) }, data: req.body }));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
