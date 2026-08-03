import { executeMysql, isDirectMysqlEnabled, queryMysql } from './mysql-direct.js';

const CADASTRO_CONFIG = {
  fornecedores: { table: 'Fornecedor', columns: ['nome', 'cnpj', 'email', 'telefone'] },
  transportadoras: { table: 'Transportadora', columns: ['nome', 'cnpj', 'email', 'telefone', 'fornecedoresVinculados'] },
  motoristas: { table: 'Motorista', columns: ['nome', 'cpf', 'telefone', 'transportadora'] },
  veiculos: { table: 'Veiculo', columns: ['placa', 'tipo', 'transportadora'] },
  docas: { table: 'Doca', columns: ['codigo', 'descricao'] },
  janelas: { table: 'Janela', columns: ['codigo', 'descricao'] },
  regras: { table: 'Regra', columns: ['nome', 'toleranciaAtrasoMin', 'tempoDescargaPrevistoMin'] },
  usuarios: { table: 'Usuario', columns: ['nome', 'email', 'senhaHash', 'perfil', 'senhaProvisoria'] }
};

function getConfig(tipo) {
  const config = CADASTRO_CONFIG[String(tipo || '')];
  if (!config) throw new Error('Tipo inválido.');
  return config;
}

function sanitizePayload(tipo, payload = {}) {
  const { columns } = getConfig(tipo);
  const clean = {};
  for (const column of columns) {
    if (payload[column] === undefined) continue;
    let value = payload[column];
    // JSON columns (e.g. Transportadora.fornecedoresVinculados) must be stringified for mysql2.
    if (column === 'fornecedoresVinculados' && Array.isArray(value)) value = JSON.stringify(value);
    clean[column] = value;
  }
  return clean;
}

function parseVinculados(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

function normalizeRow(tipo, row) {
  if (!row) return row;
  if (tipo === 'transportadoras' && 'fornecedoresVinculados' in row) {
    return { ...row, fornecedoresVinculados: parseVinculados(row.fornecedoresVinculados) };
  }
  return row;
}

export function directCadastrosEnabled() {
  return isDirectMysqlEnabled();
}

export async function listCadastroDirect(tipo) {
  const { table } = getConfig(tipo);
  const rows = await queryMysql(`SELECT * FROM \`${table}\` ORDER BY \`id\` DESC`);
  return rows.map((row) => normalizeRow(tipo, row));
}

export async function createCadastroDirect(tipo, payload = {}) {
  const { table } = getConfig(tipo);
  const clean = sanitizePayload(tipo, payload);
  const columns = Object.keys(clean);
  if (!columns.length) throw new Error('Nenhum campo válido informado para cadastro.');
  const params = columns.map((column) => clean[column]);
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}, \`createdAt\`, \`updatedAt\`) VALUES (${placeholders}, NOW(), NOW())`;
  const result = await executeMysql(sql, params);
  const rows = await queryMysql(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [result.insertId]);
  return normalizeRow(tipo, rows?.[0] || { id: result.insertId, ...clean });
}

export async function updateCadastroDirect(tipo, id, payload = {}) {
  const { table } = getConfig(tipo);
  const clean = sanitizePayload(tipo, payload);
  const columns = Object.keys(clean);
  const sets = columns.map((column) => `\`${column}\` = ?`);
  const params = columns.map((column) => clean[column]);
  sets.push('`updatedAt` = NOW()');
  params.push(Number(id));
  const sql = `UPDATE \`${table}\` SET ${sets.join(', ')} WHERE \`id\` = ?`;
  await executeMysql(sql, params);
  const rows = await queryMysql(`SELECT * FROM \`${table}\` WHERE \`id\` = ? LIMIT 1`, [Number(id)]);
  return normalizeRow(tipo, rows?.[0] || null);
}

export async function findUserByEmailDirect(email) {
  const rows = await queryMysql('SELECT * FROM `Usuario` WHERE LOWER(`email`) = LOWER(?) LIMIT 1', [String(email || '').trim()]);
  return rows?.[0] || null;
}
