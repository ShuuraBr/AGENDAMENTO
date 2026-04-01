import { Router } from "express";
import { authRequired, requireProfiles } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { validateProfile } from "../utils/validators.js";
import bcrypt from "bcryptjs";
import { auditLog } from "../utils/audit.js";

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

    const data = { ...req.body };
    if (req.params.tipo === "usuarios") {
      validateProfile(data?.perfil);
      if (!data.email || !data.nome || !data.senha) throw new Error("Usuário exige nome, e-mail, senha e perfil.");
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    const item = await prisma[m].create({ data });
    await auditLog({
      usuarioId: req.user.sub,
      perfil: req.user.perfil,
      acao: "CREATE",
      entidade: req.params.tipo.toUpperCase(),
      entidadeId: item.id,
      detalhes: data,
      ip: req.ip
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:tipo/:id", requireProfiles("ADMIN", "GESTOR"), async (req, res) => {
  try {
    const m = model(req.params.tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });

    const data = { ...req.body };
    if (req.params.tipo === "usuarios" && data?.perfil) validateProfile(data.perfil);
    if (req.params.tipo === "usuarios" && data?.senha) {
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    const item = await prisma[m].update({ where: { id: Number(req.params.id) }, data });
    await auditLog({
      usuarioId: req.user.sub,
      perfil: req.user.perfil,
      acao: "UPDATE",
      entidade: req.params.tipo.toUpperCase(),
      entidadeId: item.id,
      detalhes: data,
      ip: req.ip
    });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
