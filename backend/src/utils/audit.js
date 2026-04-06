import { prisma } from "./prisma.js";
import { addLogAuditoriaFile } from "./file-store.js";

function normalizeDetails(detalhes) {
  if (detalhes == null) return null;
  if (typeof detalhes === "string") return detalhes;
  try {
    return JSON.stringify(detalhes);
  } catch {
    return JSON.stringify({ raw: String(detalhes) });
  }
}

export async function auditLog({ usuarioId, perfil, acao, entidade, entidadeId, detalhes, ip }) {
  const payload = {
    usuarioId: usuarioId || null,
    perfil: perfil || null,
    acao,
    entidade,
    entidadeId: entidadeId != null ? Number(entidadeId) : null,
    detalhes: normalizeDetails(detalhes),
    ip: ip || null
  };

  try {
    await prisma.logAuditoria.create({ data: payload });
    return true;
  } catch (err) {
    console.error("Falha ao gravar log de auditoria no banco. Salvando em arquivo:", err.message);
    try {
      addLogAuditoriaFile(payload);
      return true;
    } catch (fileErr) {
      console.error("Falha ao gravar log de auditoria em arquivo:", fileErr.message);
      return false;
    }
  }
}
