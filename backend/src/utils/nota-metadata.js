const NOTE_META_PREFIX = '[NF_META]';
const NOTE_META_SUFFIX = '[/NF_META]';

function normalizeText(value = '') {
  return String(value ?? '').trim();
}

function parseBase64Json(value = '') {
  try {
    const json = Buffer.from(String(value || ''), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function serializeBase64Json(value = {}) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function normalizeNumber(value, decimals = null) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return decimals == null ? num : Number(num.toFixed(decimals));
}

function pickMetadata(nota = {}) {
  const metadata = {
    empresa: normalizeText(nota?.empresa || ''),
    destino: normalizeText(nota?.destino || ''),
    quantidadeItens: nota?.quantidadeItens == null ? undefined : Number(nota.quantidadeItens),
    entrada: normalizeText(nota?.entrada || ''),
    dataEntrada: normalizeText(nota?.dataEntrada || ''),
    dataEntradaBr: normalizeText(nota?.dataEntradaBr || ''),
    dataPrimeiroVencimento: normalizeText(nota?.dataPrimeiroVencimento || ''),
    dataPrimeiroVencimentoBr: normalizeText(nota?.dataPrimeiroVencimentoBr || ''),
    diasParaPrimeiroVencimento: nota?.diasParaPrimeiroVencimento == null ? null : Number(nota.diasParaPrimeiroVencimento),
    alertaVencimentoProximo: !!nota?.alertaVencimentoProximo,
    tooltipVencimento: normalizeText(nota?.tooltipVencimento || ''),
    disponivelNoRelatorio: nota?.disponivelNoRelatorio == null ? undefined : !!nota?.disponivelNoRelatorio,
    origemManual: !!nota?.origemManual,
    preLancamentoPendente: !!nota?.preLancamentoPendente,
    inseridaManual: !!nota?.inseridaManual
  };

  const entries = Object.entries(metadata).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'boolean') return value;
    return true;
  });

  return Object.fromEntries(entries);
}

export function encodeNotaObservacao(nota = {}) {
  const metadata = pickMetadata(nota);
  const observacao = normalizeText(nota?.observacao || '');
  if (!Object.keys(metadata).length) return observacao;
  return `${NOTE_META_PREFIX}${serializeBase64Json(metadata)}${NOTE_META_SUFFIX}${observacao}`;
}

export function decodeNotaObservacao(value = '') {
  const raw = String(value ?? '');
  const start = raw.indexOf(NOTE_META_PREFIX);
  const end = raw.indexOf(NOTE_META_SUFFIX);
  if (start < 0 || end < start) {
    return { metadata: {}, observacao: normalizeText(raw) };
  }

  const base64 = raw.slice(start + NOTE_META_PREFIX.length, end);
  const metadata = parseBase64Json(base64) || {};
  const before = raw.slice(0, start);
  const after = raw.slice(end + NOTE_META_SUFFIX.length);
  return {
    metadata,
    observacao: normalizeText(`${before}${after}`)
  };
}

export function normalizeAgendamentoNota(nota = {}) {
  const decoded = decodeNotaObservacao(nota?.observacao || '');
  return {
    ...nota,
    ...decoded.metadata,
    numeroNf: normalizeText(nota?.numeroNf || nota?.numero_nf || ''),
    serie: normalizeText(nota?.serie || ''),
    chaveAcesso: normalizeText(nota?.chaveAcesso || ''),
    volumes: normalizeNumber(nota?.volumes || 0),
    peso: normalizeNumber(nota?.peso || 0, 3),
    valorNf: normalizeNumber(nota?.valorNf || 0, 2),
    quantidadeItens: normalizeNumber(nota?.quantidadeItens || decoded.metadata?.quantidadeItens || 0),
    observacao: decoded.observacao
  };
}

export function normalizeAgendamentoNotas(notas = []) {
  return Array.isArray(notas) ? notas.map((nota) => normalizeAgendamentoNota(nota)) : [];
}
