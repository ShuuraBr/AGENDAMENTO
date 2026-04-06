import { prisma } from "./prisma.js";

export async function auditLog({ usuarioId, perfil, acao, entidade, entidadeId, detalhes, ip }) {
  try {
    await prisma.logAuditoria.create({
      data: {
        usuarioId: usuarioId || null,
        perfil: perfil || null,
        acao,
        entidade,
        entidadeId: entidadeId ? Number(entidadeId) : null,
        detalhes: detalhes ? JSON.stringify(detalhes) : null,
        ip: ip || null
      }
    });
  } catch (err) {
    console.error("Falha ao gravar log de auditoria:", err.message);
  }
}
