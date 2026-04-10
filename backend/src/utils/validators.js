import { PROFILE_LABELS } from "./permissions.js";

const allowedProfiles = Object.keys(PROFILE_LABELS);

export function validateProfile(profile) {
  if (!allowedProfiles.includes(profile)) {
    throw new Error("Perfil inválido.");
  }
}

export function normalizeChaveAcesso(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

export function validateNf(payload) {
  const numeroNf = String(payload?.numeroNf || "").trim();
  const chaveAcesso = normalizeChaveAcesso(payload?.chaveAcesso || "");

  if (!numeroNf && !chaveAcesso) {
    throw new Error("Informe ao menos o número da NF ou a chave de acesso.");
  }

  if (chaveAcesso && chaveAcesso.length !== 44) {
    throw new Error(`A chave de acesso deve ter 44 dígitos. Recebido: ${chaveAcesso.length}.`);
  }
}

export function validateAgendamentoPayload(payload, isPublic = false) {
  const required = [
    ["fornecedor", "Fornecedor"],
    ["transportadora", "Transportadora"],
    ["dataAgendada", "Data agendada"],
    ["horaAgendada", "Hora agendada"],
    ["janelaId", "Janela"]
  ];

  for (const [field, label] of required) {
    if (!payload[field] && payload[field] !== 0) {
      throw new Error(`${label} é obrigatório.`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.dataAgendada))) {
    throw new Error("A data deve estar no formato YYYY-MM-DD.");
  }

  if (!/^\d{2}:\d{2}$/.test(String(payload.horaAgendada))) {
    throw new Error("A hora deve estar no formato HH:MM.");
  }

  if (!isPublic) {
    const internalRequired = [
      ["emailTransportadora", "E-mail da transportadora"]
    ];
    for (const [field, label] of internalRequired) {
      if (!String(payload[field] ?? "").trim()) throw new Error(`${label} é obrigatório.`);
    }
    if (!Array.isArray(payload.notasFiscais) || !payload.notasFiscais.length) {
      throw new Error("Selecione ao menos uma NF para o agendamento interno.");
    }
  }

  if (payload.emailMotorista && !String(payload.emailMotorista).includes("@")) {
    throw new Error("E-mail do motorista inválido.");
  }

  if (payload.emailTransportadora && !String(payload.emailTransportadora).includes("@")) {
    throw new Error("E-mail da transportadora inválido.");
  }

  const cpf = String(payload.cpfMotorista || payload.cpf || "").replace(/\D/g, "");
  if (cpf && cpf.length !== 11) {
    throw new Error("CPF do motorista deve conter 11 dígitos.");
  }

  if (Number(payload.quantidadeNotas || 0) < 0) {
    throw new Error("Quantidade de notas inválida.");
  }

  if (Number(payload.quantidadeVolumes || 0) < 0) {
    throw new Error("Quantidade de volumes inválida.");
  }

  if (isPublic && !payload.lgpdConsent) {
    throw new Error("É obrigatório aceitar o termo LGPD.");
  }
}

const transitions = {
  PENDENTE_APROVACAO: ["APROVADO", "REPROVADO", "CANCELADO", "NO_SHOW"],
  APROVADO: ["CHEGOU", "EM_DESCARGA", "CANCELADO", "NO_SHOW"],
  CHEGOU: ["EM_DESCARGA", "CANCELADO"],
  EM_DESCARGA: ["FINALIZADO"],
  FINALIZADO: [],
  CANCELADO: [],
  REPROVADO: [],
  NO_SHOW: []
};

export function validateStatusTransition(current, target) {
  if (current === target) return;
  const allowed = transitions[current] || [];
  if (!allowed.includes(target)) {
    throw new Error(`Transição inválida: ${current} -> ${target}`);
  }
}
