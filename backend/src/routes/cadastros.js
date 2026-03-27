import { Router } from "express";
import { authRequired } from "../middlewares/auth.js";
import { readCollection, writeCollection, nextId, nowIso } from "../utils/store.js";

const router = Router();
router.use(authRequired);

const allowed = ["fornecedores", "transportadoras", "motoristas", "veiculos", "docas", "janelas", "regras"];

router.get("/:tipo", (req, res) => {
  const { tipo } = req.params;
  if (!allowed.includes(tipo)) return res.status(400).json({ message: "Tipo inválido." });
  res.json(readCollection(tipo));
});

router.post("/:tipo", (req, res) => {
  const { tipo } = req.params;
  if (!allowed.includes(tipo)) return res.status(400).json({ message: "Tipo inválido." });

  const items = readCollection(tipo);
  const item = {
    id: nextId(items),
    ...req.body,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  items.push(item);
  writeCollection(tipo, items);
  res.status(201).json(item);
});

router.put("/:tipo/:id", (req, res) => {
  const { tipo, id } = req.params;
  if (!allowed.includes(tipo)) return res.status(400).json({ message: "Tipo inválido." });

  const items = readCollection(tipo);
  const idx = items.findIndex(x => x.id === Number(id));
  if (idx < 0) return res.status(404).json({ message: "Registro não encontrado." });

  items[idx] = { ...items[idx], ...req.body, updatedAt: nowIso() };
  writeCollection(tipo, items);
  res.json(items[idx]);
});

export default router;
