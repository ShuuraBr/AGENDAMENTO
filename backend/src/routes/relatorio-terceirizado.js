import { Router } from "express";
import { authRequired, requirePermission } from "../middlewares/auth.js";
import { prisma } from "../utils/prisma.js";
import { normalizeCpf, normalizeChaveAcesso } from "../utils/validators.js";

const router = Router();
router.use(authRequired);

function normalizeNotas(notas) {
  return Array.isArray(notas) ? notas.map((nota) => ({
    numeroNf: String(nota?.numeroNf || "").trim(),
    serie: String(nota?.serie || "").trim(),
    chaveAcesso: normalizeChaveAcesso(nota?.chaveAcesso || ""),
    volumes: Number(nota?.volumes || 0),
    peso: Number(nota?.peso || 0),
    valorNf: Number(nota?.valorNf || 0),
    observacao: String(nota?.observacao || "").trim()
  })).filter((nota) => nota.numeroNf || nota.chaveAcesso) : [];
}

function summarizeNotas(notas = []) {
  return {
    quantidadeNotas: notas.length,
    quantidadeVolumes: notas.reduce((acc, nota) => acc + (Number(nota.volumes) || 0), 0),
    pesoTotalKg: Number(notas.reduce((acc, nota) => acc + (Number(nota.peso) || 0), 0).toFixed(3)),
    valorTotalNf: Number(notas.reduce((acc, nota) => acc + (Number(nota.valorNf) || 0), 0).toFixed(2))
  };
}

router.get("/pendentes", requirePermission("relatorio.terceirizado.view"), async (_req, res) => {
  const itens = await prisma.relatorioTerceirizado.findMany({
    where: { status: "AGUARDANDO_CHEGADA", agendamentoId: null },
    orderBy: [{ fornecedor: "asc" }, { id: "desc" }]
  });
  res.json(itens.map((item) => ({
    id: item.id,
    fornecedor: item.fornecedor,
    transportadora: item.transportadora,
    motorista: item.motorista,
    cpfMotorista: item.cpfMotorista,
    placa: item.placa,
    quantidadeNotas: item.quantidadeNotas,
    quantidadeVolumes: item.quantidadeVolumes,
    pesoTotalKg: item.pesoTotalKg,
    valorTotalNf: item.valorTotalNf,
    status: item.status,
    referenciaExterna: item.referenciaExterna
  })));
});

router.post("/importar", requirePermission("relatorio.terceirizado.manage"), async (req, res) => {
  try {
    const registros = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.items) ? req.body.items : [];
    if (!registros.length) return res.status(400).json({ message: "Envie uma lista de registros para importação." });

    const results = [];
    for (const raw of registros) {
      const notas = normalizeNotas(raw.notas || raw.notasFiscais || []);
      const resumo = summarizeNotas(notas);
      const data = {
        fornecedor: String(raw.fornecedor || "").trim(),
        transportadora: String(raw.transportadora || "").trim() || null,
        motorista: String(raw.motorista || "").trim() || null,
        cpfMotorista: normalizeCpf(raw.cpfMotorista || raw.cpf || "") || null,
        placa: String(raw.placa || "").trim().toUpperCase() || null,
        quantidadeNotas: Number(raw.quantidadeNotas || resumo.quantidadeNotas || 0),
        quantidadeVolumes: Number(raw.quantidadeVolumes || resumo.quantidadeVolumes || 0),
        pesoTotalKg: Number(raw.pesoTotalKg || resumo.pesoTotalKg || 0),
        valorTotalNf: Number(raw.valorTotalNf || resumo.valorTotalNf || 0),
        notasJson: notas.length ? JSON.stringify(notas) : null,
        status: String(raw.status || "AGUARDANDO_CHEGADA").trim() || "AGUARDANDO_CHEGADA",
        referenciaExterna: String(raw.referenciaExterna || raw.idExterno || "").trim() || null
      };
      if (!data.fornecedor) throw new Error("Fornecedor é obrigatório na importação terceirizada.");

      let saved;
      if (data.referenciaExterna) {
        saved = await prisma.relatorioTerceirizado.upsert({
          where: { referenciaExterna: data.referenciaExterna },
          update: data,
          create: data
        });
      } else {
        saved = await prisma.relatorioTerceirizado.create({ data });
      }
      results.push(saved);
    }

    res.status(201).json({ ok: true, total: results.length, items: results });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

export default router;
