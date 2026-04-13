import { Router } from "express";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { prisma, isPrismaDisabled } from "../utils/prisma.js";
import { validateProfile } from "../utils/validators.js";
import bcrypt from "bcryptjs";
import { auditLog } from "../utils/audit.js";
import { readCadastroFile, upsertCadastroFile } from "../utils/file-store.js";

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

function ensureUserCadastroPermission(req, tipo) {
  if (tipo === "usuarios" && req.user?.perfil !== "ADMIN") {
    const err = new Error("Apenas administradores podem acessar o cadastro de usuários.");
    err.statusCode = 403;
    throw err;
  }
}

async function listItems(tipo, m) {
  if (isPrismaDisabled()) {
    return readCadastroFile(tipo);
  }
  try {
    return await prisma[m].findMany({ orderBy: { id: "desc" } });
  } catch (err) {
    console.error(`Fallback em arquivo para cadastro ${tipo}:`, err?.message || err);
    return readCadastroFile(tipo);
  }
}

router.get("/:tipo", requirePermission("cadastros.view"), async (req, res) => {
  try {
    const m = model(req.params.tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });
    ensureUserCadastroPermission(req, req.params.tipo);
    res.json(await listItems(req.params.tipo, m));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
});

router.post("/:tipo", requirePermission("cadastros.manage"), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const m = model(tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });
    ensureUserCadastroPermission(req, tipo);

    const data = { ...req.body };
    if (tipo === "usuarios") {
      validateProfile(data?.perfil);
      if (!data.email || !data.nome || !data.senha) throw new Error("Usuário exige nome, e-mail, senha e perfil.");
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    let item;
    if (isPrismaDisabled()) {
      item = upsertCadastroFile(tipo, data);
    } else {
      try {
        item = await prisma[m].create({ data });
      } catch (err) {
        console.error(`Prisma indisponível em cadastro ${tipo}. Gravando em arquivo:`, err?.message || err);
        item = upsertCadastroFile(tipo, data);
      }
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: tipo.toUpperCase(), entidadeId: item.id, detalhes: data, ip: req.ip });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:tipo/:id", requirePermission("cadastros.manage"), async (req, res) => {
  try {
    const tipo = req.params.tipo;
    const m = model(tipo);
    if (!m) return res.status(400).json({ message: "Tipo inválido." });
    ensureUserCadastroPermission(req, tipo);

    const data = { ...req.body };
    if (tipo === "usuarios" && data?.perfil) validateProfile(data.perfil);
    if (tipo === "usuarios" && data?.senha) {
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    let item;
    if (isPrismaDisabled()) {
      item = upsertCadastroFile(tipo, data, req.params.id);
    } else {
      try {
        item = await prisma[m].update({ where: { id: Number(req.params.id) }, data });
      } catch (err) {
        console.error(`Prisma indisponível em atualização ${tipo}. Gravando em arquivo:`, err?.message || err);
        item = upsertCadastroFile(tipo, data, req.params.id);
      }
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "UPDATE", entidade: tipo.toUpperCase(), entidadeId: item.id, detalhes: data, ip: req.ip });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
