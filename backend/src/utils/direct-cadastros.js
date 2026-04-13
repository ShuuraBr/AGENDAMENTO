import { executeMysql, isDirectMysqlEnabled, queryMysql } from './mysql-direct.js';

const CADASTRO_CONFIG = {
  fornecedores: { table: 'Fornecedor', columns: ['nome', 'cnpj', 'email', 'telefone'] },
  transportadoras: { table: 'Transportadora', columns: ['nome', 'cnpj', 'email', 'telefone'] },
  motoristas: { table: 'Motorista', columns: ['nome', 'cpf', 'telefone', 'transportadora'] },
  veiculos: { table: 'Veiculo', columns: ['placa', 'tipo', 'transportadora'] },
  docas: { table: 'Doca', columns: ['codigo', 'descricao'] },
  janelas: { table: 'Janela', columns: ['codigo', 'descricao'] },
  regras: { table: 'Regra', columns: ['nome', 'toleranciaAtrasoMin', 'tempoDescargaPrevistoMin'] },
  usuarios: { table: 'Usuario', columns: ['nome', 'email', 'senhaHash', 'perfil'] }
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
    clean[column] = payload[column];
  }
  return clean;
}

export function directCadastrosEnabled() {
  return isDirectMysqlEnabled();
}

export async function listCadastroDirect(tipo) {
  const { table } = getConfig(tipo);
  return queryMysql(`SELECT * FROM \`${table}\` ORDER BY \`id\` DESC`);
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
  return rows?.[0] || { id: result.insertId, ...clean };
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
  return rows?.[0] || null;
}

export async function findUserByEmailDirect(email) {
  const rows = await queryMysql('SELECT * FROM `Usuario` WHERE LOWER(`email`) = LOWER(?) LIMIT 1', [String(email || '').trim()]);
  return rows?.[0] || null;
}
