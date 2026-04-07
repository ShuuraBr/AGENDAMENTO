import { prisma } from "./prisma.js";
import { readAuditLogs, writeAuditLogs } from "./file-store.js";

function nextLogId(items = []) {
  return items.reduce((max, item) => Math.max(max, Number(item?.id || 0)), 0) + 1;
}

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

async function persistAuditFile(entry) {
  try {
    const items = readAuditLogs();
    const record = { id: nextLogId(items), ...entry };
    items.unshift(record);
    writeAuditLogs(items.slice(0, 5000));
    return record;
  } catch (error) {
    console.error("Falha ao gravar log de auditoria em arquivo:", error?.message || error);
    return null;
  }
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
    console.error("Falha ao gravar log de auditoria no banco. Usando arquivo:", err?.message || err);
  }

  await persistAuditFile(entry);
}
