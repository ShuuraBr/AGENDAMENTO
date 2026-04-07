import { prisma } from "./prisma.js";

function normalizePayload({ usuarioId, usuarioNome, perfil, acao, entidade, entidadeId, detalhes, ip }) {
  return {
    usuarioId: usuarioId || null,
    usuarioNome: usuarioNome || null,
    perfil: perfil || null,
    acao,
    entidade,
    entidadeId: entidadeId ? Number(entidadeId) : null,
    detalhes: detalhes ? JSON.stringify(detalhes) : null,
    ip: ip || null,
    createdAt: new Date().toISOString()
  };
}

export async function auditLog({ usuarioId, usuarioNome, perfil, acao, entidade, entidadeId, detalhes, ip }) {
  const entry = normalizePayload({ usuarioId, usuarioNome, perfil, acao, entidade, entidadeId, detalhes, ip });

  try {
    await prisma.logAuditoria.create({
      data: {
        usuarioId: entry.usuarioId,
        perfil: entry.perfil,
        acao: entry.acao,
        entidade: entry.entidade,
        entidadeId: entry.entidadeId,
        detalhes: entry.detalhes,
        ip: entry.ip
      }
    });
  } catch (err) {
    console.error("Falha ao gravar log de auditoria no banco:", err?.message || err);
  }
}
