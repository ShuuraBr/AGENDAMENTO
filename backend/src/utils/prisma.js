import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { getMysqlPool, isDirectMysqlEnabled } from './mysql-direct.js';
import { generatePublicToken } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '../..');
const envPath = path.join(backendRoot, '.env');

dotenv.config({ override: true });
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

const modelConfigs = {
  usuario: { tables: ['Usuario', 'usuarios'], aliases: { senhaHash: ['senha_hash'], perfilId: ['perfil_id'], createdAt: ['created_at'], updatedAt: ['updated_at'], ultimoLoginEm: ['ultimo_login_em'] } },
  perfil: { tables: ['Perfil', 'perfis'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  fornecedor: { tables: ['Fornecedor', 'fornecedores'], aliases: { nome: ['razao_social', 'nome_fantasia'], razaoSocial: ['razao_social'], nomeFantasia: ['nome_fantasia'], createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  transportadora: { tables: ['Transportadora', 'transportadoras'], aliases: { nome: ['razao_social', 'nome_fantasia'], razaoSocial: ['razao_social'], nomeFantasia: ['nome_fantasia'], createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  motorista: { tables: ['Motorista', 'motoristas'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'], transportadora: ['transportadora_id'] } },
  veiculo: { tables: ['Veiculo', 'veiculos'], aliases: { placa: ['placa_cavalo'], tipo: ['tipo_veiculo'], createdAt: ['created_at'], updatedAt: ['updated_at'], transportadora: ['transportadora_id'] } },
  doca: { tables: ['Doca', 'docas'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'], unidadeId: ['unidade_id'], ativa: ['ativa'] } },
  janela: { tables: ['Janela', 'Janelas', 'janela_agendamento', 'janelaAgendamento', 'janelas'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'], dataAgendamento: ['data_agendamento'], horaInicio: ['hora_inicio'], horaFim: ['hora_fim'], capacidadeTotal: ['capacidade_total'], ocupacaoAtual: ['ocupacao_atual'], disponivel: ['disponivel'], ativa: ['ativa'] } },
  janelaAgendamento: { tables: ['JanelaAgendamento', 'Janela', 'janelas', 'janela_agendamento'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'], dataAgendamento: ['data_agendamento'], horaInicio: ['hora_inicio'], horaFim: ['hora_fim'], capacidadeTotal: ['capacidade_total'], ocupacaoAtual: ['ocupacao_atual'], disponivel: ['disponivel'], ativa: ['ativa'] } },
  regra: { tables: ['Regra', 'regras', 'regra_agendamento', 'RegrasAgendamento'], aliases: { toleranciaAtrasoMin: ['tolerancia_atraso_min'], tempoDescargaPrevistoMin: ['tempo_descarga_previsto_min'], createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  regraAgendamento: { tables: ['RegraAgendamento', 'Regra', 'regras', 'regra_agendamento'], aliases: { toleranciaAtrasoMin: ['tolerancia_atraso_min'], tempoDescargaPrevistoMin: ['tempo_descarga_previsto_min'], createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  unidade: { tables: ['Unidade', 'unidades'], aliases: { createdAt: ['created_at'], updatedAt: ['updated_at'] } },
  agendamento: { tables: ['Agendamento', 'agendamentos'], aliases: { publicTokenMotorista: ['public_token_motorista'], publicTokenFornecedor: ['public_token_fornecedor'], checkinToken: ['checkin_token'], checkoutToken: ['checkout_token'], cpfMotorista: ['cpf_motorista'], telefoneMotorista: ['telefone_motorista'], emailMotorista: ['email_motorista'], emailTransportadora: ['email_transportadora'], docaId: ['doca_id'], janelaId: ['janela_id'], unidadeId: ['unidade_id'], fornecedorId: ['fornecedor_id'], transportadoraId: ['transportadora_id'], motoristaId: ['motorista_id'], veiculoId: ['veiculo_id'], dataAgendada: ['data_agendada'], horaAgendada: ['hora_agendada'], quantidadeNotas: ['quantidade_notas'], quantidadeVolumes: ['quantidade_volumes'], pesoTotalKg: ['peso_total_kg'], valorTotalNf: ['valor_total_nf'], motivoReprovacao: ['motivo_reprovacao'], motivoCancelamento: ['motivo_cancelamento'], inicioDescargaEm: ['inicio_descarga_em'], fimDescargaEm: ['fim_descarga_em'], checkinEm: ['checkin_em', 'chegada_real_em'], lgpdConsentAt: ['lgpd_consent_at'], createdAt: ['created_at'], updatedAt: ['updated_at'], aprovadoPorUsuarioId: ['aprovado_por_usuario_id'], criadoPorUsuarioId: ['criado_por_usuario_id'], aprovadoEm: ['aprovado_em'], origemSolicitacao: ['origem_solicitacao'], observacoesInternas: ['observacoes_internas'], canceladoPorUsuarioId: ['cancelado_por_usuario_id'], canceladoEm: ['cancelado_em'], chegadaRealEm: ['chegada_real_em'], noShow: ['no_show'], atrasoMinutos: ['atraso_minutos'], conformidadeStatus: ['conformidade_status'] } },
  notaFiscal: { tables: ['NotaFiscal', 'nota_fiscal', 'notas_fiscais'], aliases: { agendamentoId: ['agendamento_id'], numeroNf: ['numero_nf'], chaveAcesso: ['chave_acesso'], valorNf: ['valor_nf'], createdAt: ['created_at'] } },
  documento: { tables: ['Documento', 'documentos'], aliases: { agendamentoId: ['agendamento_id'], tipoDocumento: ['tipo_documento'], nomeArquivo: ['nome_arquivo'], urlArquivo: ['url_arquivo'], mimeType: ['mime_type'], tamanhoBytes: ['tamanho_bytes'], createdAt: ['created_at'] } },
  logAuditoria: { tables: ['LogAuditoria', 'logs_auditoria', 'log_auditoria'], aliases: { usuarioId: ['usuario_id'], entidadeId: ['entidade_id'], createdAt: ['created_at'], usuarioNome: ['usuario_nome'] } },
  relatorioTerceirizado: { tables: ['RelatorioTerceirizado', 'relatorio_terceirizado'], aliases: { rowHash: ['row_hash'], agendamentoId: ['agendamento_id'], origemArquivo: ['origem_arquivo'], dadosOriginaisJson: ['dados_originais_json'], updatedAt: ['updated_at'], importedAt: ['imported_at'], referenciaExterna: ['referencia_externa'], fornecedor: ['Fornecedor'], transportadora: ['Transportadora'], motorista: ['Motorista'], cpfMotorista: ['cpfMotorista'], placa: ['placa'], quantidadeNotas: ['quantidadeNotas'], quantidadeVolumes: ['quantidadeVolumes'], pesoTotalKg: ['pesoTotalKg'], valorTotalNf: ['valorTotalNf'], notasJson: ['notasJson'], status: ['Status'] } }
};

const tableCache = new Map();
const columnsCache = new Map();
let disabledReason = '';

function qid(value) {
  return '`' + String(value).replace(/`/g, '``') + '`';
}

function camelToSnake(value = '') {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function snakeToCamel(value = '') {
  return String(value).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function formatDateOnly(value) {
  if (value == null || value === '') return value;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  const raw = String(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : raw;
}

function formatTimeOnly(value) {
  if (value == null || value === '') return value;
  if (value instanceof Date) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`;
  }
  const raw = String(value).trim();
  if (/^\d{2}:\d{2}$/.test(raw)) return `${raw}:00`;
  return raw;
}

function formatDateTime(value) {
  if (value == null || value === '') return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function normalizeSqlValue(prop, column, value) {
  if (value == null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) {
    const lower = String(column || prop || '').toLowerCase();
    if (lower.includes('data') && !lower.includes('updated') && !lower.includes('created') && !lower.includes('em')) return formatDateOnly(value);
    if (lower.includes('hora')) return formatTimeOnly(value);
    return formatDateTime(value);
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value);
  }
  return value;
}

function getModelConfig(modelName) {
  return modelConfigs[modelName] || { tables: [modelName], aliases: {} };
}

function getCandidateColumns(modelName, field) {
  const config = getModelConfig(modelName);
  const aliases = config.aliases?.[field] || [];
  const base = [field, camelToSnake(field), snakeToCamel(field), ...aliases].filter(Boolean);
  return [...new Set(base)];
}

async function resolveTableName(modelName, ctx) {
  const cacheKey = `${ctx.cachePrefix}:${modelName}`;
  if (tableCache.has(cacheKey)) return tableCache.get(cacheKey);
  const config = getModelConfig(modelName);
  for (const candidate of config.tables || []) {
    const rows = await ctx.query(
      'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) LIMIT 1',
      [candidate]
    );
    const tableName = rows?.[0]?.TABLE_NAME || rows?.[0]?.table_name || null;
    if (tableName) {
      tableCache.set(cacheKey, tableName);
      return tableName;
    }
  }
  tableCache.set(cacheKey, null);
  return null;
}

async function getTableColumns(modelName, ctx) {
  const tableName = await resolveTableName(modelName, ctx);
  const cacheKey = `${ctx.cachePrefix}:${tableName || modelName}`;
  if (columnsCache.has(cacheKey)) return columnsCache.get(cacheKey);
  if (!tableName) {
    const empty = { list: [], set: new Set(), map: new Map() };
    columnsCache.set(cacheKey, empty);
    return empty;
  }
  const rows = await ctx.query(`SHOW COLUMNS FROM ${qid(tableName)}`);
  const list = rows.map((row) => String(row.Field || row.field || '')).filter(Boolean);
  const set = new Set(list);
  const map = new Map(list.map((column) => [String(column).toLowerCase(), column]));
  const info = { list, set, map };
  columnsCache.set(cacheKey, info);
  return info;
}

async function resolveColumnName(modelName, field, ctx) {
  const columns = await getTableColumns(modelName, ctx);
  for (const candidate of getCandidateColumns(modelName, field)) {
    if (columns.set.has(candidate)) return candidate;
    const lower = columns.map.get(String(candidate).toLowerCase());
    if (lower) return lower;
  }
  return null;
}

function buildExecutor(connection = null) {
  return {
    cachePrefix: connection ? 'tx' : 'pool',
    async query(sql, params = []) {
      const target = connection || await getMysqlPool();
      const [rows] = await target.query(sql, params);
      return rows;
    },
    async execute(sql, params = []) {
      const target = connection || await getMysqlPool();
      const [result] = await target.execute(sql, params);
      return result;
    }
  };
}

function applySelect(row, select) {
  if (!select || typeof select !== 'object') return row;
  const output = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (!enabled) continue;
    output[key] = row?.[key];
  }
  return output;
}

function normalizeRow(modelName, row = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(row || {})) {
    if (key in normalized) {
      normalized[key] = value;
      continue;
    }
    const camel = snakeToCamel(key);
    normalized[camel] = value;
    if (!(key in normalized)) normalized[key] = value;
  }

  if (modelName === 'fornecedor' || modelName === 'transportadora') {
    if (!normalized.nome && normalized.razaoSocial) normalized.nome = normalized.razaoSocial;
  }
  if (modelName === 'veiculo') {
    if (!normalized.placa && normalized.placaCavalo) normalized.placa = normalized.placaCavalo;
    if (!normalized.tipo && normalized.tipoVeiculo) normalized.tipo = normalized.tipoVeiculo;
  }
  if (modelName === 'agendamento') {
    if (normalized.dataAgendada instanceof Date) normalized.dataAgendada = formatDateOnly(normalized.dataAgendada);
    else if (normalized.dataAgendada) normalized.dataAgendada = formatDateOnly(normalized.dataAgendada);
    if (normalized.horaAgendada) normalized.horaAgendada = formatTimeOnly(normalized.horaAgendada).slice(0, 5);
    if (normalized.chegadaRealEm && !normalized.checkinEm) normalized.checkinEm = normalized.chegadaRealEm;
  }
  if (modelName === 'usuario') {
    if (!normalized.senhaHash && normalized.senha_hash) normalized.senhaHash = normalized.senha_hash;
    if (typeof normalized.perfil === 'string') normalized.perfilNome = normalized.perfil;
  }
  return normalized;
}

async function buildWhereClause(modelName, where, ctx) {
  if (!where || typeof where !== 'object' || !Object.keys(where).length) {
    return { sql: '', params: [] };
  }

  const parts = [];
  const params = [];

  for (const [field, value] of Object.entries(where)) {
    if (field === 'OR' && Array.isArray(value)) {
      const orParts = [];
      const orParams = [];
      for (const item of value) {
        const built = await buildWhereClause(modelName, item, ctx);
        if (built.sql) {
          orParts.push(`(${built.sql})`);
          orParams.push(...built.params);
        }
      }
      if (orParts.length) {
        parts.push(orParts.join(' OR '));
        params.push(...orParams);
      } else {
        parts.push('1=0');
      }
      continue;
    }

    if (field === 'AND' && Array.isArray(value)) {
      const andParts = [];
      const andParams = [];
      for (const item of value) {
        const built = await buildWhereClause(modelName, item, ctx);
        if (built.sql) {
          andParts.push(`(${built.sql})`);
          andParams.push(...built.params);
        }
      }
      if (andParts.length) {
        parts.push(andParts.join(' AND '));
        params.push(...andParams);
      }
      continue;
    }

    const column = await resolveColumnName(modelName, field, ctx);
    if (!column) continue;

    if (value === null) {
      parts.push(`${qid(column)} IS NULL`);
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      const subParts = [];
      if (Object.prototype.hasOwnProperty.call(value, 'in') && Array.isArray(value.in)) {
        if (!value.in.length) {
          subParts.push('1=0');
        } else {
          subParts.push(`${qid(column)} IN (${value.in.map(() => '?').join(', ')})`);
          params.push(...value.in.map((item) => normalizeSqlValue(field, column, item)));
        }
      }
      if (Object.prototype.hasOwnProperty.call(value, 'not')) {
        if (value.not === null) {
          subParts.push(`${qid(column)} IS NOT NULL`);
        } else if (typeof value.not === 'object' && value.not && Array.isArray(value.not.in)) {
          subParts.push(`${qid(column)} NOT IN (${value.not.in.map(() => '?').join(', ')})`);
          params.push(...value.not.in.map((item) => normalizeSqlValue(field, column, item)));
        } else {
          subParts.push(`${qid(column)} <> ?`);
          params.push(normalizeSqlValue(field, column, value.not));
        }
      }
      if (Object.prototype.hasOwnProperty.call(value, 'contains')) {
        subParts.push(`${qid(column)} LIKE ?`);
        params.push(`%${String(value.contains)}%`);
      }
      if (Object.prototype.hasOwnProperty.call(value, 'startsWith')) {
        subParts.push(`${qid(column)} LIKE ?`);
        params.push(`${String(value.startsWith)}%`);
      }
      if (Object.prototype.hasOwnProperty.call(value, 'endsWith')) {
        subParts.push(`${qid(column)} LIKE ?`);
        params.push(`%${String(value.endsWith)}`);
      }
      if (Object.prototype.hasOwnProperty.call(value, 'gte')) {
        subParts.push(`${qid(column)} >= ?`);
        params.push(normalizeSqlValue(field, column, value.gte));
      }
      if (Object.prototype.hasOwnProperty.call(value, 'lte')) {
        subParts.push(`${qid(column)} <= ?`);
        params.push(normalizeSqlValue(field, column, value.lte));
      }
      if (Object.prototype.hasOwnProperty.call(value, 'gt')) {
        subParts.push(`${qid(column)} > ?`);
        params.push(normalizeSqlValue(field, column, value.gt));
      }
      if (Object.prototype.hasOwnProperty.call(value, 'lt')) {
        subParts.push(`${qid(column)} < ?`);
        params.push(normalizeSqlValue(field, column, value.lt));
      }
      if (subParts.length) {
        parts.push(subParts.length > 1 ? `(${subParts.join(' AND ')})` : subParts[0]);
      }
      continue;
    }

    parts.push(`${qid(column)} = ?`);
    params.push(normalizeSqlValue(field, column, value));
  }

  return { sql: parts.join(' AND '), params };
}

async function buildOrderByClause(modelName, orderBy, ctx) {
  const entries = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  const parts = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object') continue;
    for (const [field, direction] of Object.entries(item)) {
      const column = await resolveColumnName(modelName, field, ctx);
      if (!column) continue;
      parts.push(`${qid(column)} ${String(direction).toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`);
    }
  }
  return parts.length ? ` ORDER BY ${parts.join(', ')}` : '';
}

async function resolveForeignName(modelName, id, ctx) {
  if (!id) return null;
  const row = await createModelApi(modelName, ctx).findUnique({ where: { id: Number(id) } });
  if (!row) return null;
  return row.nome || row.razaoSocial || row.codigo || row.placa || row.protocolo || null;
}

async function preprocessData(modelName, data = {}, ctx, mode = 'create') {
  const processed = { ...(data || {}) };

  if (modelName === 'agendamento') {
    // Only format dataAgendada / horaAgendada when they were explicitly provided
    // in the input.  Previously the unconditional assignment introduced `undefined`
    // (converted to NULL) on every update, wiping the stored schedule.
    if ('dataAgendada' in processed) {
      processed.dataAgendada = formatDateOnly(processed.dataAgendada);
    }
    if ('horaAgendada' in processed) {
      processed.horaAgendada = formatTimeOnly(processed.horaAgendada);
    }

    // Auto-generate protocol and tokens only during creation.
    // On updates these fields are NOT in the payload, so the old code
    // treated them as missing and generated brand-new values that
    // overwrote the originals in the database.
    if (mode === 'create') {
      if (!processed.protocolo) processed.protocolo = `AGD-${Date.now()}`;
      if (!processed.publicTokenMotorista) processed.publicTokenMotorista = generatePublicToken('MOT', processed.cpfMotorista || processed.placa || processed.motorista || processed.protocolo);
      if (!processed.publicTokenFornecedor) processed.publicTokenFornecedor = generatePublicToken('FOR', processed.fornecedor || processed.protocolo);
      if (!processed.checkinToken) processed.checkinToken = generatePublicToken('CHK', processed.cpfMotorista || processed.placa || processed.protocolo);
      if (!processed.checkoutToken) processed.checkoutToken = generatePublicToken('OUT', processed.cpfMotorista || processed.placa || processed.protocolo);
    }

    if (processed.lgpdConsentAt) processed.lgpdConsentAt = formatDateTime(processed.lgpdConsentAt);
    if (processed.inicioDescargaEm) processed.inicioDescargaEm = formatDateTime(processed.inicioDescargaEm);
    if (processed.fimDescargaEm) processed.fimDescargaEm = formatDateTime(processed.fimDescargaEm);
    if (processed.checkinEm) processed.checkinEm = formatDateTime(processed.checkinEm);
    if (processed.chegadaRealEm) processed.chegadaRealEm = formatDateTime(processed.chegadaRealEm);
    if (processed.aprovadoEm) processed.aprovadoEm = formatDateTime(processed.aprovadoEm);
    if (processed.canceladoEm) processed.canceladoEm = formatDateTime(processed.canceladoEm);

    if (!processed.fornecedor && processed.fornecedorId) processed.fornecedor = await resolveForeignName('fornecedor', processed.fornecedorId, ctx);
    if (!processed.transportadora && processed.transportadoraId) processed.transportadora = await resolveForeignName('transportadora', processed.transportadoraId, ctx);
    if (!processed.motorista && processed.motoristaId) processed.motorista = await resolveForeignName('motorista', processed.motoristaId, ctx);
    if (!processed.placa && processed.veiculoId) processed.placa = await resolveForeignName('veiculo', processed.veiculoId, ctx);
  }

  if (modelName === 'usuario' && processed.ultimoLoginEm) {
    processed.ultimoLoginEm = formatDateTime(processed.ultimoLoginEm);
  }

  if (modelName === 'logAuditoria') {
    if (processed.detalhes && typeof processed.detalhes !== 'string') {
      processed.detalhes = JSON.stringify(processed.detalhes);
    }
    if (processed.createdAt) {
      processed.createdAt = formatDateTime(processed.createdAt);
    }
  }

  if (modelName === 'notaFiscal') {
    if (processed.createdAt) processed.createdAt = formatDateTime(processed.createdAt);
  }

  if (modelName === 'documento') {
    if (processed.createdAt) processed.createdAt = formatDateTime(processed.createdAt);
  }

  if (modelName === 'relatorioTerceirizado') {
    if (processed.updatedAt) processed.updatedAt = formatDateTime(processed.updatedAt);
    if (processed.importedAt) processed.importedAt = formatDateTime(processed.importedAt);
  }

  if (mode === 'update') {
    delete processed.id;
  }

  return processed;
}

async function hydrateUsuarioPerfil(row, ctx) {
  if (!row) return row;
  if (typeof row.perfil === 'string' && row.perfil.trim()) {
    return { ...row, perfil: { nome: row.perfil.trim(), id: row.perfilId || null } };
  }
  if (row.perfilId) {
    const perfil = await createModelApi('perfil', ctx).findUnique({ where: { id: Number(row.perfilId) } });
    if (perfil) return { ...row, perfil };
  }
  return { ...row, perfil: row.perfil || null };
}

async function findByName(modelName, name, ctx) {
  if (!name) return null;
  const api = createModelApi(modelName, ctx);
  const fields = ['nome', 'razaoSocial', 'nomeFantasia', 'codigo', 'placa'];
  for (const field of fields) {
    const column = await resolveColumnName(modelName, field, ctx);
    if (!column) continue;
    const row = await api.findFirst({ where: { [field]: name } });
    if (row) return row;
  }
  return null;
}

async function hydrateAgendamentoRelations(row, include, ctx) {
  if (!row || !include) return row;
  const output = { ...row };
  if (include.notasFiscais) output.notasFiscais = await createModelApi('notaFiscal', ctx).findMany({ where: { agendamentoId: Number(row.id) }, orderBy: { id: 'asc' } });
  if (include.documentos) output.documentos = await createModelApi('documento', ctx).findMany({ where: { agendamentoId: Number(row.id) }, orderBy: { id: 'asc' } });
  if (include.doca) output.doca = row.docaId ? await createModelApi('doca', ctx).findUnique({ where: { id: Number(row.docaId) } }) : null;
  if (include.janela) output.janela = row.janelaId ? await createModelApi('janela', ctx).findUnique({ where: { id: Number(row.janelaId) } }) : null;
  if (include.unidade) output.unidade = row.unidadeId ? await createModelApi('unidade', ctx).findUnique({ where: { id: Number(row.unidadeId) } }) : null;
  if (include.fornecedor) output.fornecedor = row.fornecedorId ? await createModelApi('fornecedor', ctx).findUnique({ where: { id: Number(row.fornecedorId) } }) : (await findByName('fornecedor', row.fornecedor, ctx)) || (row.fornecedor ? { nome: row.fornecedor, razaoSocial: row.fornecedor } : null);
  if (include.transportadora) output.transportadora = row.transportadoraId ? await createModelApi('transportadora', ctx).findUnique({ where: { id: Number(row.transportadoraId) } }) : (await findByName('transportadora', row.transportadora, ctx)) || (row.transportadora ? { nome: row.transportadora, razaoSocial: row.transportadora } : null);
  if (include.motorista) output.motorista = row.motoristaId ? await createModelApi('motorista', ctx).findUnique({ where: { id: Number(row.motoristaId) } }) : (await findByName('motorista', row.motorista, ctx)) || (row.motorista ? { nome: row.motorista, cpf: row.cpfMotorista || null, telefone: row.telefoneMotorista || null, email: row.emailMotorista || null } : null);
  if (include.veiculo) output.veiculo = row.veiculoId ? await createModelApi('veiculo', ctx).findUnique({ where: { id: Number(row.veiculoId) } }) : (await findByName('veiculo', row.placa, ctx)) || (row.placa ? { placa: row.placa } : null);
  return output;
}

async function hydrateLogAuditoriaRelations(row, include, ctx) {
  if (!row || !include) return row;
  const output = { ...row };
  if (include.usuario) {
    output.usuario = row.usuarioId ? await createModelApi('usuario', ctx).findUnique({ where: { id: Number(row.usuarioId) }, include: { perfil: true } }) : null;
  }
  return output;
}

async function hydrateRelations(modelName, row, include, ctx) {
  if (!row || !include) return row;
  if (modelName === 'usuario' && include.perfil) return hydrateUsuarioPerfil(row, ctx);
  if (modelName === 'agendamento') return hydrateAgendamentoRelations(row, include, ctx);
  if (modelName === 'logAuditoria') return hydrateLogAuditoriaRelations(row, include, ctx);
  return row;
}

function createModelApi(modelName, ctx) {
  return {
    async findMany(options = {}) {
      const tableName = await resolveTableName(modelName, ctx);
      if (!tableName) return [];
      const where = await buildWhereClause(modelName, options.where, ctx);
      const orderBy = await buildOrderByClause(modelName, options.orderBy, ctx);
      const limit = Number(options.take || 0) > 0 ? ` LIMIT ${Number(options.take)}` : '';
      const offset = Number(options.skip || 0) > 0 ? ` OFFSET ${Number(options.skip)}` : '';
      const sql = `SELECT * FROM ${qid(tableName)}${where.sql ? ` WHERE ${where.sql}` : ''}${orderBy}${limit}${offset}`;
      const rows = await ctx.query(sql, where.params);
      const normalizedRows = [];
      for (const row of rows || []) {
        let item = normalizeRow(modelName, row);
        item = await hydrateRelations(modelName, item, options.include, ctx);
        if (modelName === 'usuario' && options.include?.perfil && (!item.perfil || typeof item.perfil !== 'object')) {
          item = await hydrateUsuarioPerfil(item, ctx);
        }
        normalizedRows.push(options.select ? applySelect(item, options.select) : item);
      }
      return normalizedRows;
    },

    async findUnique(options = {}) {
      const items = await this.findMany({ ...options, take: 1 });
      return items[0] || null;
    },

    async findFirst(options = {}) {
      const items = await this.findMany({ ...options, take: 1 });
      return items[0] || null;
    },

    async count(options = {}) {
      const tableName = await resolveTableName(modelName, ctx);
      if (!tableName) return 0;
      const where = await buildWhereClause(modelName, options.where, ctx);
      const rows = await ctx.query(`SELECT COUNT(*) AS total FROM ${qid(tableName)}${where.sql ? ` WHERE ${where.sql}` : ''}`, where.params);
      return Number(rows?.[0]?.total || 0);
    },

    async create(options = {}) {
      const tableName = await resolveTableName(modelName, ctx);
      if (!tableName) throw new Error(`Tabela não encontrada para o modelo ${modelName}.`);
      const processed = await preprocessData(modelName, options.data || {}, ctx, 'create');
      const columns = [];
      const params = [];
      for (const [field, value] of Object.entries(processed)) {
        const column = await resolveColumnName(modelName, field, ctx);
        if (!column) continue;
        columns.push(column);
        params.push(normalizeSqlValue(field, column, value));
      }
      if (!columns.length) throw new Error(`Nenhum campo persistível encontrado para o modelo ${modelName}.`);
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO ${qid(tableName)} (${columns.map(qid).join(', ')}) VALUES (${placeholders})`;
      const result = await ctx.execute(sql, params);
      const id = Number(result?.insertId || 0);
      if (id) return this.findUnique({ where: { id }, include: options.include, select: options.select });
      return this.findFirst({ where: options.data, include: options.include, select: options.select });
    },

    async createMany(options = {}) {
      const data = Array.isArray(options.data) ? options.data : [];
      let count = 0;
      for (const item of data) {
        await this.create({ data: item });
        count += 1;
      }
      return { count };
    },

    async update(options = {}) {
      const tableName = await resolveTableName(modelName, ctx);
      if (!tableName) throw new Error(`Tabela não encontrada para o modelo ${modelName}.`);
      const where = await buildWhereClause(modelName, options.where, ctx);
      if (!where.sql) throw new Error(`Condição de atualização inválida para ${modelName}.`);
      const processed = await preprocessData(modelName, options.data || {}, ctx, 'update');
      const sets = [];
      const params = [];
      for (const [field, value] of Object.entries(processed)) {
        const column = await resolveColumnName(modelName, field, ctx);
        if (!column) continue;
        sets.push(`${qid(column)} = ?`);
        params.push(normalizeSqlValue(field, column, value));
      }
      if (!sets.length) {
        return this.findUnique({ where: options.where, include: options.include, select: options.select });
      }
      await ctx.execute(`UPDATE ${qid(tableName)} SET ${sets.join(', ')} WHERE ${where.sql}`, [...params, ...where.params]);
      return this.findUnique({ where: options.where, include: options.include, select: options.select });
    },

    async upsert(options = {}) {
      const existing = await this.findUnique({ where: options.where });
      if (existing) {
        return this.update({ where: options.where, data: options.update || {}, include: options.include, select: options.select });
      }
      return this.create({ data: options.create || {}, include: options.include, select: options.select });
    }
  };
}

function createClient(ctx) {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '$queryRawUnsafe') return async (sql, ...params) => ctx.query(sql, params.flat());
      if (prop === '$executeRawUnsafe') return async (sql, ...params) => ctx.execute(sql, params.flat());
      if (prop === '$connect') return async () => true;
      if (prop === '$disconnect') return async () => true;
      if (prop === '$transaction') {
        return async (callback) => {
          const pool = await getMysqlPool();
          const connection = await pool.getConnection();
          try {
            await connection.beginTransaction();
            const txClient = createClient(buildExecutor(connection));
            const result = await callback(txClient);
            await connection.commit();
            return result;
          } catch (error) {
            try { await connection.rollback(); } catch {}
            throw error;
          } finally {
            connection.release();
          }
        };
      }
      return createModelApi(String(prop), ctx);
    }
  });
}

export function isPrismaEnginePanic() {
  return false;
}

export async function disablePrisma(errorOrReason) {
  disabledReason = String(errorOrReason?.message || errorOrReason || 'MySQL direto indisponível.');
  return new Error(disabledReason);
}

export async function resetPrismaClient() {
  tableCache.clear();
  columnsCache.clear();
  disabledReason = '';
}

export async function getPrismaClient() {
  if (!isDirectMysqlEnabled()) {
    throw new Error(getPrismaDisableReason());
  }
  return createClient(buildExecutor());
}

export function getPrismaLoadError() {
  return null;
}

export function isPrismaDisabled() {
  return !isDirectMysqlEnabled();
}

export function getPrismaDisableReason() {
  return disabledReason || 'MySQL direto indisponível: variáveis de ambiente não configuradas.';
}

export const prisma = createClient(buildExecutor());
