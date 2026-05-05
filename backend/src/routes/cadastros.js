import { Router } from "express";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { validateProfile } from "../utils/validators.js";
import bcrypt from "bcryptjs";
import { auditLog } from "../utils/audit.js";
import { readCadastroFile, upsertCadastroFile } from "../utils/file-store.js";
import { createCadastroDirect, directCadastrosEnabled, listCadastroDirect, updateCadastroDirect } from "../utils/direct-cadastros.js";
import { logOnce } from "../utils/log-once.js";

const router = Router();
router.use(authRequired);

const validTipos = new Set([
  'fornecedores', 'transportadoras', 'motoristas', 'veiculos', 'docas', 'janelas', 'regras', 'usuarios'
]);

function ensureTipo(tipo) {
  const normalized = String(tipo || '');
  if (!validTipos.has(normalized)) throw new Error('Tipo inválido.');
  return normalized;
}

function ensureUserCadastroPermission(req, tipo) {
  if (tipo === "usuarios" && req.user?.perfil !== "ADMIN") {
    const err = new Error("Apenas administradores podem acessar o cadastro de usuários.");
    err.statusCode = 403;
    throw err;
  }
}

async function listItems(tipo) {
  if (directCadastrosEnabled()) {
    try {
      return await listCadastroDirect(tipo);
    } catch (err) {
      logOnce(`cadastro-list-${tipo}`, `Cadastro ${tipo} operando em arquivo (listagem):`, err?.message || err);
    }
  }
  return readCadastroFile(tipo);
}

router.get("/:tipo", requirePermission("cadastros.view"), async (req, res) => {
  try {
    const tipo = ensureTipo(req.params.tipo);
    ensureUserCadastroPermission(req, tipo);
    res.json(await listItems(tipo));
  } catch (err) {
    res.status(err.statusCode || 400).json({ message: err.message });
  }
});

router.post("/:tipo", requirePermission("cadastros.manage"), async (req, res) => {
  try {
    const tipo = ensureTipo(req.params.tipo);
    ensureUserCadastroPermission(req, tipo);

    const data = { ...req.body };
    if (tipo === "usuarios") {
      validateProfile(data?.perfil);
      if (!data.email || !data.nome || !data.senha) throw new Error("Usuário exige nome, e-mail, senha e perfil.");
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    let item = null;
    if (directCadastrosEnabled()) {
      try {
        item = await createCadastroDirect(tipo, data);
      } catch (err) {
        logOnce(`cadastro-create-${tipo}`, `Cadastro ${tipo} operando em arquivo (criação):`, err?.message || err);
      }
    }
    if (!item) {
      item = upsertCadastroFile(tipo, data);
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "CREATE", entidade: tipo.toUpperCase(), entidadeId: item.id, detalhes: data, ip: req.ip });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.put("/:tipo/:id", requirePermission("cadastros.manage"), async (req, res) => {
  try {
    const tipo = ensureTipo(req.params.tipo);
    ensureUserCadastroPermission(req, tipo);

    const data = { ...req.body };
    if (tipo === "usuarios" && data?.perfil) validateProfile(data.perfil);
    if (tipo === "usuarios" && data?.senha) {
      data.senhaHash = await bcrypt.hash(String(data.senha), 10);
      delete data.senha;
    }

    let item = null;
    if (directCadastrosEnabled()) {
      try {
        item = await updateCadastroDirect(tipo, req.params.id, data);
      } catch (err) {
        logOnce(`cadastro-update-${tipo}`, `Cadastro ${tipo} operando em arquivo (atualização):`, err?.message || err);
      }
    }
    if (!item) {
      item = upsertCadastroFile(tipo, data, req.params.id);
    }

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "UPDATE", entidade: tipo.toUpperCase(), entidadeId: item.id, detalhes: data, ip: req.ip });
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /transportadoras/:id/vincular-fornecedores
// Atribui uma transportadora a um ou mais fornecedores (salvo no JSON local)
// para pré-preencher o campo de transportadora ao agendar.
// Body: { fornecedores: ["Fornecedor A", "Fornecedor B"] }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/transportadoras/:id/vincular-fornecedores", requirePermission("cadastros.manage"), async (req, res) => {
  try {
    const fornecedores = Array.isArray(req.body?.fornecedores) ? req.body.fornecedores.map((f) => String(f).trim()).filter(Boolean) : [];
    if (!fornecedores.length) return res.status(400).json({ message: "Informe ao menos um fornecedor." });

    const id = req.params.id;
    // Read current transportadoras
    const items = readCadastroFile("transportadoras");
    const idx = items.findIndex((t) => String(t.id) === String(id));
    if (idx < 0) return res.status(404).json({ message: "Transportadora não encontrada." });

    // Merge fornecedores list
    const existing = Array.isArray(items[idx].fornecedoresVinculados) ? items[idx].fornecedoresVinculados : [];
    const merged = [...new Set([...existing, ...fornecedores])];
    items[idx] = { ...items[idx], fornecedoresVinculados: merged };
    upsertCadastroFile("transportadoras", items[idx], id);

    await auditLog({ usuarioId: req.user.sub, perfil: req.user.perfil, acao: "VINCULAR_TRANSPORTADORA_FORNECEDOR", entidade: "TRANSPORTADORA", entidadeId: id, detalhes: { fornecedores }, ip: req.ip });
    res.json({ ok: true, id, fornecedoresVinculados: merged });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /transportadoras/por-fornecedor?nome=X
// Retorna a transportadora padrão vinculada ao fornecedor
router.get("/transportadoras/por-fornecedor", requirePermission("cadastros.view"), async (req, res) => {
  try {
    const nome = String(req.query?.nome || "").trim().toLowerCase();
    if (!nome) return res.status(400).json({ message: "Informe o nome do fornecedor." });
    const items = readCadastroFile("transportadoras");
    const match = items.find((t) => Array.isArray(t.fornecedoresVinculados) && t.fornecedoresVinculados.some((f) => String(f).trim().toLowerCase() === nome));
    res.json(match || null);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
