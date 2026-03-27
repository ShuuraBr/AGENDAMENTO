const allowedProfiles = ["ADMIN", "OPERADOR", "PORTARIA", "GESTOR"];

export function validateProfile(profile) {
  if (!allowedProfiles.includes(profile)) {
    throw new Error("Perfil inválido.");
  }
}

export function validateNf(payload) {
  if (!payload.numeroNf && !payload.chaveAcesso) {
    throw new Error("Informe ao menos o número da NF ou a chave de acesso.");
  }
  if (payload.chaveAcesso) {
    const digits = String(payload.chaveAcesso).replace(/\D/g, "");
    if (digits.length !== 44) throw new Error("A chave de acesso deve ter 44 dígitos.");
  }
}

export function validateAgendamentoPayload(payload, isPublic = false) {
  const required = [
    ["fornecedor", "Fornecedor"],
    ["transportadora", "Transportadora"],
    ["motorista", "Motorista"],
    ["placa", "Placa"],
    ["dataAgendada", "Data agendada"],
    ["horaAgendada", "Hora agendada"],
    ...(!isPublic ? [["docaId", "Doca"]] : []),
    ["janelaId", "Janela"]
  ];
  for (const [field, label] of required) {
    if (!payload[field] && payload[field] !== 0) throw new Error(`${label} é obrigatório.`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.dataAgendada))) {
    throw new Error("A data deve estar no formato YYYY-MM-DD.");
  }
  if (!/^\d{2}:\d{2}$/.test(String(payload.horaAgendada))) {
    throw new Error("A hora deve estar no formato HH:MM.");
  }
  if (payload.emailMotorista && !String(payload.emailMotorista).includes("@")) {
    throw new Error("E-mail do motorista inválido.");
  }
  if (payload.emailTransportadora && !String(payload.emailTransportadora).includes("@")) {
    throw new Error("E-mail da transportadora inválido.");
  }
  if (Number(payload.quantidadeNotas || 0) < 0) throw new Error("Quantidade de notas inválida.");
  if (Number(payload.quantidadeVolumes || 0) < 0) throw new Error("Quantidade de volumes inválida.");
  if (isPublic && !payload.lgpdConsent) throw new Error("É obrigatório aceitar o termo LGPD.");
}

const transitions = {
  PENDENTE_APROVACAO: ["APROVADO", "REPROVADO", "CANCELADO", "NO_SHOW"],
  APROVADO: ["CHEGOU", "CANCELADO", "NO_SHOW"],
  CHEGOU: ["EM_DESCARGA", "CANCELADO"],
  EM_DESCARGA: ["FINALIZADO"],
  FINALIZADO: [],
  CANCELADO: [],
  REPROVADO: [],
  NO_SHOW: []
};

export function validateStatusTransition(current, target) {
  const allowed = transitions[current] || [];
  if (!allowed.includes(target)) {
    throw new Error(`Transição inválida: ${current} -> ${target}`);
  }
}
