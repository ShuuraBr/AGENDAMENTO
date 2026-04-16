import { getPrismaClient, isPrismaDisabled, getPrismaDisableReason } from "./prisma.js";

function normalizeContains(value) {
  const text = String(value || "").trim();
  return text ? { contains: text } : undefined;
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

function extractItemTotals(item = {}) {
  const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais : [];
  const destinos = [...new Set(notas.map((nota) => String(nota?.destino || nota?.empresa || '').trim()).filter(Boolean))];
  const totalItens = notas.reduce((acc, nota) => acc + Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0), 0);
  return {
    totalNotas: Number(item?.quantidadeNotas || notas.length || 0),
    totalVolumes: Number(item?.quantidadeVolumes || notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0) || 0),
    pesoTotalKg: Number(item?.pesoTotalKg || notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0) || 0),
    totalItens: Number(item?.totalItens || totalItens || 0),
    destinos,
    notasDetalhes: notas.map((nota) => ({
      numeroNf: String(nota?.numeroNf || '').trim(),
      serie: String(nota?.serie || '').trim(),
      destino: String(nota?.destino || nota?.empresa || '').trim(),
      peso: Number(nota?.peso || 0),
      volumes: Number(nota?.volumes || 0),
      itens: Number(nota?.quantidadeItens || nota?.qtdItens || nota?.itens || 0)
    }))
  };
}

function mapAgendamento(item = {}) {
  return {
    ...item,
    doca: item?.doca ? { id: item.doca.id, codigo: item.doca.codigo, descricao: item.doca.descricao || '' } : null,
    janela: item?.janela ? { id: item.janela.id, codigo: item.janela.codigo, descricao: item.janela.descricao || '' } : null,
    documentos: Array.isArray(item?.documentos) ? item.documentos : [],
    notasFiscais: Array.isArray(item?.notasFiscais) ? item.notasFiscais : []
  };
}

export async function fetchUserByEmail(email) {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  return client.usuario.findUnique({ where: { email: String(email || '').trim() } });
}

export async function fetchJanelasDocas() {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const [janelas, docas] = await Promise.all([
    client.janela.findMany({ select: { id: true, codigo: true, descricao: true }, orderBy: { codigo: 'asc' } }),
    client.doca.findMany({ select: { id: true, codigo: true, descricao: true }, orderBy: { codigo: 'asc' } })
  ]);
  return { janelas, docas };
}

export async function fetchAgendamentosByDatasStatuses(datas = [], statuses = []) {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  if (!datas.length || !statuses.length) return [];
  return client.agendamento.findMany({
    where: {
      dataAgendada: { in: datas.map((item) => String(item)) },
      status: { in: statuses.map((item) => String(item)) }
    },
    select: {
      dataAgendada: true,
      janelaId: true,
      protocolo: true,
      status: true,
      motorista: true,
      placa: true,
      fornecedor: true,
      transportadora: true,
      horaAgendada: true
    }
  });
}

export async function pingDatabase() {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");
  const rows = await client.$queryRaw`SELECT 1 AS ok, DATABASE() AS databaseName`;
  return rows?.[0] || { ok: 1 };
}

export async function fetchAgendamentosRaw(filters = {}) {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");

  const where = {
    ...(normalizeContains(filters.fornecedor) ? { fornecedor: normalizeContains(filters.fornecedor) } : {}),
    ...(normalizeContains(filters.transportadora) ? { transportadora: normalizeContains(filters.transportadora) } : {}),
    ...(normalizeContains(filters.motorista) ? { motorista: normalizeContains(filters.motorista) } : {}),
    ...(normalizeContains(filters.placa) ? { placa: normalizeContains(filters.placa) } : {}),
    ...(filters.status ? { status: String(filters.status) } : {}),
    ...(filters.dataAgendada ? { dataAgendada: String(filters.dataAgendada) } : {})
  };

  const rows = await client.agendamento.findMany({
    where,
    include: { doca: true, janela: true, notasFiscais: true, documentos: true },
    orderBy: { id: 'desc' }
  });

  return rows.map(mapAgendamento);
}

export async function fetchDocaPainelRaw(dataAgendada = null) {
  if (isPrismaDisabled()) throw new Error(getPrismaDisableReason() || "Prisma desabilitado.");
  const client = await getPrismaClient();
  if (!client) throw new Error("Prisma client indisponível.");

  const [docas, agendamentos] = await Promise.all([
    client.doca.findMany({ select: { id: true, codigo: true, descricao: true }, orderBy: { codigo: 'asc' } }),
    client.agendamento.findMany({
      where: dataAgendada ? { dataAgendada: String(dataAgendada) } : undefined,
      include: { notasFiscais: true },
      orderBy: [{ horaAgendada: 'asc' }, { id: 'asc' }]
    })
  ]);

  return docas.map((doca) => {
    const fila = agendamentos
      .filter((item) => Number(item?.docaId || 0) === Number(doca.id) && occupiesDocaStatus(item?.status))
      .sort((a, b) => {
        const pa = queuePriority(a?.status);
        const pb = queuePriority(b?.status);
        if (pa !== pb) return pa - pb;
        return String(a?.horaAgendada || '').localeCompare(String(b?.horaAgendada || ''));
      })
      .map((item) => ({ ...item, ...extractItemTotals(item) }));

    const ativo = fila.find((item) => ["CHEGOU", "EM_DESCARGA"].includes(String(item?.status || ''))) || fila[0] || null;
    const resumo = {
      totalAgendamentos: fila.length,
      totalNotas: fila.reduce((acc, item) => acc + Number(item?.totalNotas || 0), 0),
      totalVolumes: Number(fila.reduce((acc, item) => acc + Number(item?.totalVolumes || 0), 0).toFixed(3)),
      totalPesoKg: Number(fila.reduce((acc, item) => acc + Number(item?.pesoTotalKg || 0), 0).toFixed(3))
    };

    return {
      docaId: doca.id,
      codigo: doca.codigo,
      descricao: doca.descricao || '',
      ocupacaoAtual: ativo ? ativo.status : 'LIVRE',
      semaforo: ativo ? trafficColor(ativo.status) : 'VERDE',
      ...resumo,
      fila
    };
  });
}
