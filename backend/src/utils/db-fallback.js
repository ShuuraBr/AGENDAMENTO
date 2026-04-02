import { getPrismaClient } from "./prisma.js";

function qid(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

async function resolveTableName(candidates = []) {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível para fallback SQL.");

  const normalized = [...new Set(candidates.map((v) => String(v).trim()).filter(Boolean))];
  if (!normalized.length) throw new Error("Nenhuma tabela candidata informada.");

  const placeholders = normalized.map(() => "LOWER(?)").join(", ");
  const sql = `
    SELECT TABLE_NAME
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND LOWER(TABLE_NAME) IN (${placeholders})
    ORDER BY TABLE_NAME ASC
    LIMIT 1
  `;

  const rows = await client.$queryRawUnsafe(sql, ...normalized.map((v) => v.toLowerCase()));
  const tableName = rows?.[0]?.TABLE_NAME || rows?.[0]?.table_name;
  if (!tableName) {
    throw new Error(`Tabela não encontrada. Procuradas: ${normalized.join(", ")}`);
  }
  return tableName;
}

export async function fetchUserByEmail(email) {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const table = await resolveTableName(["Usuario", "usuario", "usuarios"]);
  const sql = `
    SELECT id, nome, email, senhaHash, perfil, createdAt, updatedAt
    FROM ${qid(table)}
    WHERE email = ?
    LIMIT 1
  `;
  const rows = await client.$queryRawUnsafe(sql, email);
  return rows?.[0] || null;
}

export async function fetchJanelasDocas() {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const [janelaTable, docaTable] = await Promise.all([
    resolveTableName(["Janela", "janela", "janelas"]),
    resolveTableName(["Doca", "doca", "docas"])
  ]);

  const [janelas, docas] = await Promise.all([
    client.$queryRawUnsafe(`SELECT id, codigo, descricao FROM ${qid(janelaTable)} ORDER BY codigo ASC`),
    client.$queryRawUnsafe(`SELECT id, codigo, descricao FROM ${qid(docaTable)} ORDER BY codigo ASC`)
  ]);

  return { janelas, docas };
}

export async function fetchAgendamentosByDatasStatuses(datas = [], statuses = []) {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  if (!datas.length || !statuses.length) return [];
  const table = await resolveTableName(["Agendamento", "agendamento", "agendamentos"]);
  const dataMarks = datas.map(() => "?").join(", ");
  const statusMarks = statuses.map(() => "?").join(", ");
  const sql = `
    SELECT dataAgendada, janelaId, protocolo, status, motorista, placa, fornecedor, transportadora, horaAgendada
    FROM ${qid(table)}
    WHERE dataAgendada IN (${dataMarks})
      AND status IN (${statusMarks})
  `;
  return client.$queryRawUnsafe(sql, ...datas, ...statuses);
}

export async function pingDatabase() {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const rows = await client.$queryRawUnsafe("SELECT 1 AS ok, DATABASE() AS databaseName");
  return rows?.[0] || { ok: 1 };
}


export async function fetchAgendamentosRaw(filters = {}) {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const [agTable, docaTable, janelaTable] = await Promise.all([
    resolveTableName(["Agendamento", "agendamento", "agendamentos"]),
    resolveTableName(["Doca", "doca", "docas"]),
    resolveTableName(["Janela", "janela", "janelas"])
  ]);

  const where = [];
  const args = [];
  const likeFields = ["fornecedor", "transportadora", "motorista", "placa"];
  for (const field of likeFields) {
    if (filters[field]) {
      where.push(`a.${qid(field)} LIKE ?`);
      args.push(`%${String(filters[field]).trim()}%`);
    }
  }
  if (filters.status) { where.push(`a.${qid('status')} = ?`); args.push(String(filters.status)); }
  if (filters.dataAgendada) { where.push(`a.${qid('dataAgendada')} = ?`); args.push(String(filters.dataAgendada)); }

  const sql = `
    SELECT
      a.*,
      d.id AS doca_id_rel, d.codigo AS doca_codigo, d.descricao AS doca_descricao,
      j.id AS janela_id_rel, j.codigo AS janela_codigo, j.descricao AS janela_descricao
    FROM ${qid(agTable)} a
    LEFT JOIN ${qid(docaTable)} d ON d.id = a.docaId
    LEFT JOIN ${qid(janelaTable)} j ON j.id = a.janelaId
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.id DESC
  `;

  const rows = await client.$queryRawUnsafe(sql, ...args);
  return rows.map((row) => ({
    ...row,
    doca: row.doca_codigo ? { id: row.doca_id_rel, codigo: row.doca_codigo, descricao: row.doca_descricao || '' } : null,
    janela: row.janela_codigo ? { id: row.janela_id_rel, codigo: row.janela_codigo, descricao: row.janela_descricao || '' } : null,
    notasFiscais: [],
    documentos: []
  }));
}


function occupiesDocaStatus(status) {
  return ["PENDENTE_APROVACAO", "APROVADO", "CHEGOU", "EM_DESCARGA"].includes(String(status || ""));
}

function queuePriority(status) {
  const map = { CHEGOU: 1, EM_DESCARGA: 2, APROVADO: 3, PENDENTE_APROVACAO: 4 };
  return map[String(status || "")] || 99;
}

function trafficColor(status) {
  if (["EM_DESCARGA", "CHEGOU"].includes(String(status || ""))) return "VERDE";
  if (["APROVADO", "PENDENTE_APROVACAO"].includes(String(status || ""))) return "AMARELO";
  return "VERMELHO";
}

export async function fetchDocaPainelRaw(dataAgendada = null) {
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");

  const [agTable, docaTable] = await Promise.all([
    resolveTableName(["Agendamento", "agendamento", "agendamentos"]),
    resolveTableName(["Doca", "doca", "docas"])
  ]);

  const where = [];
  const args = [];
  if (dataAgendada) {
    where.push(`a.${qid("dataAgendada")} = ?`);
    args.push(String(dataAgendada));
  }

  const [docas, agendamentos] = await Promise.all([
    client.$queryRawUnsafe(`SELECT id, codigo, descricao FROM ${qid(docaTable)} ORDER BY codigo ASC`),
    client.$queryRawUnsafe(`
      SELECT a.id, a.protocolo, a.status, a.motorista, a.placa, a.fornecedor, a.transportadora, a.horaAgendada, a.docaId, a.janelaId, a.dataAgendada
      FROM ${qid(agTable)} a
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.horaAgendada ASC, a.id ASC
    `, ...args)
  ]);

  return docas.map((doca) => {
    const fila = agendamentos
      .filter((a) => Number(a.docaId) === Number(doca.id) && occupiesDocaStatus(a.status))
      .sort((a, b) => {
        const pa = queuePriority(a.status);
        const pb = queuePriority(b.status);
        if (pa !== pb) return pa - pb;
        return String(a.horaAgendada || "").localeCompare(String(b.horaAgendada || ""));
      });

    const ativo = fila.find((a) => ["CHEGOU", "EM_DESCARGA"].includes(String(a.status || ""))) || fila[0] || null;

    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao || "",
      ocupacaoAtual: ativo ? ativo.status : "LIVRE",
      semaforo: ativo ? trafficColor(ativo.status) : "VERDE",
      fila
    };
  });
}
