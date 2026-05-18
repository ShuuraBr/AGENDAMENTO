(() => {
  const state = {
    token: localStorage.getItem("token") || "",
    cadastroTipo: "fornecedores",
    cadastroEditId: null,
    cadastroCache: [],
    nfRows: 1,
    nfDrafts: [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }],
    disponibilidadePublica: [],
    pendingFornecedores: [],
    cameraStream: null,
    barcodeDetector: null,
    scanning: false,
    internalPendingFornecedor: null,
    internalPendingFornecedores: [],
    internalSelectedNotas: [],
    internalSelectedNotaKeys: new Set(),
    internalPendingSearchTerm: "",
    internalFornecedorSearchTerm: "",
    publicPendingSearchTerm: "",
    docaOptions: [],
    currentUser: null,
    auditoria: [],
    avaliacaoToken: "",
    missingRelatorioAlertKeys: new Set(),
    notificacoes: [],
    notifPollInterval: null,
    confirmacoesSelecionados: new Set()
  };

  const PROFILE_PERMISSIONS = {
    ADMIN: [
      "dashboard.view", "docas.view", "logs.view", "cadastros.view", "cadastros.manage", "users.manage",
      "agendamentos.view", "agendamentos.create", "agendamentos.consulta_nf", "agendamentos.definir_doca",
      "agendamentos.approve", "agendamentos.reprove", "agendamentos.reschedule", "agendamentos.request_reschedule",
      "agendamentos.cancel", "agendamentos.start", "agendamentos.finish", "agendamentos.no_show",
      "agendamentos.checkin", "agendamentos.documentos", "agendamentos.notas", "agendamentos.notify",
      "confirmacoes.view", "financeiro.summary",
      "relatorio.view", "relatorio.manage", "relatorio.terceirizado.view", "relatorio.terceirizado.manage"
    ],
    GESTOR: [
      "dashboard.view", "docas.view", "logs.view", "cadastros.view", "cadastros.manage",
      "agendamentos.view", "agendamentos.create", "agendamentos.consulta_nf", "agendamentos.definir_doca",
      "agendamentos.approve", "agendamentos.reprove", "agendamentos.reschedule", "agendamentos.request_reschedule",
      "agendamentos.cancel", "agendamentos.start", "agendamentos.finish", "agendamentos.no_show",
      "agendamentos.checkin", "agendamentos.documentos", "agendamentos.notas", "agendamentos.notify",
      "confirmacoes.view", "financeiro.summary",
      "relatorio.view", "relatorio.manage", "relatorio.terceirizado.view", "relatorio.terceirizado.manage"
    ],
    OPERADOR: [
      "dashboard.view", "docas.view", "cadastros.view", "cadastros.manage",
      "agendamentos.view", "agendamentos.create", "agendamentos.consulta_nf",
      "agendamentos.documentos", "agendamentos.notas",
      "relatorio.view", "relatorio.terceirizado.view"
    ],
    PORTARIA: [
      "agendamentos.checkin"
    ]
  };

  const VIEW_PERMISSIONS = {
    dashboard: "dashboard.view",
    docas: "docas.view",
    cadastros: "cadastros.view",
    agendamentos: "agendamentos.create",
    confirmacoes: "confirmacoes.view",
    "consulta-nf": "agendamentos.consulta_nf",
    checkin: "agendamentos.checkin"
  };


  const CADASTRO_TAB_PERMISSIONS = {
    fornecedores: 'cadastros.view',
    transportadoras: 'cadastros.view',
    motoristas: 'cadastros.view',
    veiculos: 'cadastros.view',
    docas: 'cadastros.view',
    janelas: 'cadastros.view',
    regras: 'cadastros.view',
    usuarios: 'users.manage'
  };

  const CADASTRO_CONFIG = {
    fornecedores: {
      titulo: "Cadastro de fornecedores",
      endpoint: "/api/cadastros/fornecedores",
      fields: [
        { name: "nome", label: "Nome / Razão social", type: "text", required: true },
        { name: "cnpj", label: "CNPJ", type: "text" },
        { name: "email", label: "E-mail", type: "email" },
        { name: "telefone", label: "Telefone", type: "text" }
      ]
    },
    transportadoras: {
      titulo: "Cadastro de transportadoras",
      endpoint: "/api/cadastros/transportadoras",
      fields: [
        { name: "nome", label: "Nome / Razão social", type: "text", required: true },
        { name: "cnpj", label: "CNPJ", type: "text" },
        { name: "email", label: "E-mail", type: "email" },
        { name: "telefone", label: "Telefone", type: "text" },
        { name: "fornecedoresVinculados", label: "Fornecedores vinculados (separados por vírgula)", type: "text", full: true, isArray: true }
      ]
    },
    motoristas: {
      titulo: "Cadastro de motoristas",
      endpoint: "/api/cadastros/motoristas",
      fields: [
        { name: "nome", label: "Nome", type: "text", required: true },
        { name: "cpf", label: "CPF", type: "text" },
        { name: "telefone", label: "Telefone", type: "text" },
        { name: "transportadora", label: "Transportadora", type: "text" }
      ]
    },
    veiculos: {
      titulo: "Cadastro de veículos",
      endpoint: "/api/cadastros/veiculos",
      fields: [
        { name: "placa", label: "Placa", type: "text", required: true },
        { name: "tipo", label: "Tipo", type: "text" },
        { name: "transportadora", label: "Transportadora", type: "text" }
      ]
    },
    docas: {
      titulo: "Cadastro de docas",
      endpoint: "/api/cadastros/docas",
      fields: [
        { name: "codigo", label: "Código", type: "text", required: true },
        { name: "descricao", label: "Descrição", type: "text", full: true }
      ]
    },
    janelas: {
      titulo: "Cadastro de janelas",
      endpoint: "/api/cadastros/janelas",
      fields: [
        { name: "codigo", label: "Código da janela", type: "text", required: true },
        { name: "descricao", label: "Descrição", type: "text", full: true }
      ]
    },
    regras: {
      titulo: "Cadastro de regras",
      endpoint: "/api/cadastros/regras",
      fields: [
        { name: "nome", label: "Nome", type: "text", required: true },
        { name: "toleranciaAtrasoMin", label: "Tolerância atraso (min)", type: "number" },
        { name: "tempoDescargaPrevistoMin", label: "Tempo descarga previsto (min)", type: "number" }
      ]
    },
    usuarios: {
      titulo: "Cadastro de usuários",
      endpoint: "/api/cadastros/usuarios",
      fields: [
        { name: "nome", label: "Nome", type: "text", required: true },
        { name: "email", label: "E-mail", type: "email", required: true },
        { name: "perfil", label: "Perfil", type: "select", options: [
          { value: "ADMIN", text: "Administrador" },
          { value: "OPERADOR", text: "Operador" },
          { value: "PORTARIA", text: "Portaria" },
          { value: "GESTOR", text: "Gestor" }
        ] },
        { name: "_info_senha", label: "Senha inicial", type: "info", value: "O usuário receberá a senha provisória Obj@2026 e deverá alterá-la no primeiro acesso." }
      ]
    }
  };

  function byId(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateBR(dateText) {
    if (!dateText) return "";
    const [y, m, d] = String(dateText).split("-");
    if (!y || !m || !d) return dateText;
    return `${d}/${m}/${y}`;
  }

  function normalizeDateToIso(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
    return raw;
  }

  function formatIntegerBR(value) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '0';
  }

  function formatDecimalBR(value, decimals = 3) {
    const n = Number(value || 0);
    return Number.isFinite(n)
      ? n.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
      : Number(0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function parseNumberBR(value) {
    if (typeof value === 'number') return value;
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatCpf(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  function formatPhone(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits ? `(${digits}` : '';
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function formatHour(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
    if (digits.length <= 2) return digits;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }

  function normalizeCompanyKey(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '')
      .toUpperCase();
  }

  const STORE_LOGOS = {
    'OBJ': '/assets/store-obj.svg',
    'AC COELHO': '/assets/store-ac-coelho.svg',
    'SR ACABAMENTOS': '/assets/store-sr-acabamentos.svg',
    'FINITURA': '/assets/store-finitura.svg'
  };

  function resolveStoreKey(value) {
    const normalized = normalizeCompanyKey(value);
    if (!normalized) return '';
    if (normalized.includes('ACCOELHO') || normalized === 'COELHO') return 'AC COELHO';
    if (normalized.includes('SRACABAMENTOS') || normalized.includes('ACABAMENTOS')) return 'SR ACABAMENTOS';
    if (normalized.includes('FINITURA')) return 'FINITURA';
    if (normalized.includes('2FILIAL') || normalized.includes('FILIAL')) return 'OBJ';
    if (normalized.includes('1OBJETIVA') || normalized.includes('OBJ') || normalized.includes('OBJETIVA')) return 'OBJ';
    return '';
  }

  function noteEmpresaMatches(nota, target) {
    const desired = resolveStoreKey(target) || normalizeCompanyKey(target);
    const destinationCandidates = [nota?.destino, nota?.destinoRelatorio]
      .map((value) => resolveStoreKey(value) || normalizeCompanyKey(value))
      .filter(Boolean);
    const fallbackCandidates = [nota?.empresa, nota?.empresaRelatorio]
      .map((value) => resolveStoreKey(value) || normalizeCompanyKey(value))
      .filter(Boolean);
    const candidates = destinationCandidates.length ? destinationCandidates : fallbackCandidates;
    if (!desired || !candidates.length) return false;
    return candidates.some((candidate) => candidate === desired || candidate.includes(desired) || desired.includes(candidate));
  }

  function renderStoreLogo(value, { showEmpty = false } = {}) {
    const storeKey = resolveStoreKey(value);
    if (!storeKey) return showEmpty ? '<span class="store-logo store-logo-empty">Sem destino</span>' : '';
    const src = STORE_LOGOS[storeKey] || '';
    return src
      ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(storeKey)}" class="store-logo-image" title="${escapeHtml(storeKey)}" />`
      : `<span class="store-logo">${escapeHtml(storeKey)}</span>`;
  }

  function renderEmpresaNotas(item, targetEmpresa) {
    const notas = (Array.isArray(item?.notasFiscais) ? item.notasFiscais : Array.isArray(item?.notas) ? item.notas : [])
      .filter((nota) => noteEmpresaMatches(nota, targetEmpresa));
    if (!notas.length) return '<span>-</span>';
    return `<div class="nf-series-list">${notas.map((nota) => {
      const numero = `NF ${String(nota?.numeroNf || '-').trim() || '-'}`;
      const serie = String(nota?.serie || '').trim();
      const label = serie ? `${numero} • Série ${serie}` : numero;
      return `<span class="nf-series-item">${escapeHtml(label)}</span>`;
    }).join('')}</div>`;
  }

  function normalizeDigitsValue(value) {
    return String(value || '').replace(/\D/g, '');
  }

  function formatRemainingDaysLabel(value) {
    const raw = normalizeDateToIso(value);
    if (!raw) return '-';
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '-';
    const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const diff = Math.round((target - today) / 86400000);
    if (!Number.isFinite(diff)) return '-';
    if (diff === 0) return 'Hoje';
    if (diff > 0) return `${diff} dia(s)`;
    return `${Math.abs(diff)} dia(s) atrás`;
  }

  function sortPendingFornecedores(items = []) {
    return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
      if (!!a.possuiVencimentoProximo !== !!b.possuiVencimentoProximo) return a.possuiVencimentoProximo ? -1 : 1;
      const nearA = Number(a.totalNotasVencimentoProximo || 0);
      const nearB = Number(b.totalNotasVencimentoProximo || 0);
      if (nearA !== nearB) return nearB - nearA;
      return String(a.fornecedor || a.nome || '').localeCompare(String(b.fornecedor || b.nome || ''), 'pt-BR');
    });
  }

  function formatDateInputBR(value) {
    const digits = String(value || '').replace(/\D/g, '').slice(0, 8);
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
  }

  function applyInputMasks(root = document) {
    root.querySelectorAll('input[name="cpfMotorista"]').forEach((input) => {
      input.addEventListener('input', () => { input.value = formatCpf(input.value); });
      input.value = formatCpf(input.value);
    });

    root.querySelectorAll('input[name="telefoneMotorista"], input[name="telefone"]').forEach((input) => {
      input.addEventListener('input', () => { input.value = formatPhone(input.value); });
      input.value = formatPhone(input.value);
    });

    root.querySelectorAll('input[name="horaAgendada"]').forEach((input) => {
      input.addEventListener('input', () => { input.value = formatHour(input.value); });
      input.value = formatHour(input.value);
    });

    root.querySelectorAll('input[name="dataAgendada"]').forEach((input) => {
      if (input.type === 'text') {
        input.addEventListener('input', () => { input.value = formatDateInputBR(input.value); });
        input.value = input.value ? formatDateInputBR(input.value) : formatDateBR(new Date().toISOString().slice(0, 10));
      }
    });
  }

  function renderNotaSerieList(item) {
    const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais : Array.isArray(item?.notas) ? item.notas : [];
    if (!notas.length) return `<span>${escapeHtml(formatIntegerBR(item?.quantidadeNotas ?? 0))}</span>`;
    const warning = item?.monitoramentoNf?.notasAusentesNoRelatorio?.length
      ? `<span class="nf-alert-badge nf-alert-badge-danger" title="Existem notas deste agendamento que não constam mais no relatório terceirizado.">NF indisponível no relatório</span>`
      : '';
    return `<div class="nf-series-list">${notas.slice(0, 3).map((nota) => {
      const numero = `NF ${String(nota?.numeroNf || '-').trim() || '-'}`;
      const serie = `Série ${String(nota?.serie || '-').trim() || '-'}`;
      const classes = ['nf-series-item'];
      if (nota?.alertaVencimentoProximo) classes.push('nf-series-item-warning');
      if (nota?.disponivelNoRelatorio === false) classes.push('nf-series-item-danger');
      const tooltip = nota?.tooltipVencimento || (nota?.disponivelNoRelatorio === false ? 'NF não localizada no relatório terceirizado atual.' : '');
      return `<span class="${classes.join(' ')}" title="${escapeHtml(tooltip)}">${escapeHtml(`${numero} • ${serie}`)}</span>`;
    }).join('')}${notas.length > 3 ? `<span class="nf-series-item">${escapeHtml(`+${notas.length - 3} NF`)}</span>` : ''}${warning}</div>`;
  }

  function statusLabel(status) {
    const normalized = String(status || "").trim().toUpperCase();
    if (!normalized || normalized === 'SOLICITADO') return 'Pendente aprovação';
    return normalized.replaceAll("_", " ");
  }

  function statusTone(status = "", semaforo = "") {
    const statusMap = {
      SOLICITADO: 'amarelo',
      PENDENTE_APROVACAO: 'amarelo',
      APROVADO: 'azul',
      CHEGOU: 'laranja',
      EM_DESCARGA: 'laranja',
      FINALIZADO: 'verde',
      CANCELADO: 'vermelho',
      REPROVADO: 'vermelho',
      NO_SHOW: 'cinza',
      LIVRE: 'verde'
    };
    const direct = statusMap[String(status || '').toUpperCase()];
    if (direct) return direct;
    const hint = String(semaforo || '').toLowerCase();
    if (hint.includes('verde')) return 'verde';
    if (hint.includes('amarelo')) return 'amarelo';
    if (hint.includes('azul')) return 'azul';
    if (hint.includes('laranja')) return 'laranja';
    if (hint.includes('cinza')) return 'cinza';
    if (hint.includes('vermelho')) return 'vermelho';
    return 'azul';
  }

  function renderStatusBadge(status, semaforo) {
    return `<span class="badge ${statusTone(status, semaforo)}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function renderNotasTable(notas) {
    if (!Array.isArray(notas) || !notas.length) return '<p class="hint">Sem notas fiscais cadastradas.</p>';
    return `<table class="table"><thead><tr><th>Número NF</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas.map((nota) => `<tr><td>${escapeHtml(nota.numeroNf || "-")}</td><td>${escapeHtml(nota.serie || "-")}</td><td>${escapeHtml(nota.chaveAcesso || "-")}</td><td>${escapeHtml(formatDecimalBR(nota.volumes ?? 0, 3))}</td></tr>`).join("")}</tbody></table>`;
  }

  function normalizePendingNota(item = {}) {
    return {
      rowHash: String(item.rowHash || '').trim(),
      fornecedor: String(item.fornecedor || item.fornecedorGrupo || '').trim(),
      fornecedorGrupo: String(item.fornecedorGrupo || item.fornecedor || '').trim(),
      numeroNf: String(item.numeroNf || item.numero_nf || '').trim(),
      serie: String(item.serie || '').trim(),
      empresa: String(item.empresa || '').trim(),
      destino: String(item.destino || '').trim(),
      dataEntrada: String(item.dataEntrada || '').trim(),
      dataEntradaBr: String(item.dataEntradaBr || '').trim(),
      entrada: String(item.entrada || '').trim(),
      chaveAcesso: String(item.chaveAcesso || '').trim(),
      volumes: Number(item.volumes || 0),
      peso: Number(item.peso || 0),
      valorNf: Number(item.valorNf || 0),
      observacao: String(item.observacao || '').trim(),
      dataPrimeiroVencimento: String(item.dataPrimeiroVencimento || '').trim(),
      dataPrimeiroVencimentoBr: String(item.dataPrimeiroVencimentoBr || '').trim(),
      diasParaPrimeiroVencimento: item.diasParaPrimeiroVencimento == null ? null : Number(item.diasParaPrimeiroVencimento),
      alertaVencimentoProximo: !!item.alertaVencimentoProximo,
      tooltipVencimento: String(item.tooltipVencimento || '').trim(),
      origemManual: !!item.origemManual,
      inseridaManual: !!item.inseridaManual,
      preLancamentoPendente: !!item.preLancamentoPendente,
      disponivelNoRelatorio: item.disponivelNoRelatorio === false ? false : true
    };
  }

  function normalizePendingFornecedor(item = {}) {
    const notas = (Array.isArray(item.notasFiscais) ? item.notasFiscais : Array.isArray(item.notas) ? item.notas : []).map(normalizePendingNota);
    return {
      ...item,
      notas,
      notasFiscais: notas,
      quantidadeNotas: Number(item.quantidadeNotas ?? notas.length ?? 0),
      quantidadeVolumes: Number(item.quantidadeVolumes ?? notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0)),
      pesoTotalKg: Number(item.pesoTotalKg ?? notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0)),
      valorTotalNf: Number(item.valorTotalNf ?? notas.reduce((acc, nota) => acc + Number(nota?.valorNf || 0), 0)),
      totalNotasVencimentoProximo: Number(item.totalNotasVencimentoProximo ?? notas.filter((nota) => nota.alertaVencimentoProximo).length),
      possuiVencimentoProximo: !!(item.possuiVencimentoProximo ?? notas.some((nota) => nota.alertaVencimentoProximo))
    };
  }

  function getPendingFornecedorById(id) {
    return (state.pendingFornecedores || []).find((item) => String(item.id) === String(id)) || null;
  }

  function populateSelectOptions(select, items, placeholder, formatter = (value) => value, selectedValue = "") {
    if (!select) return;
    const current = selectedValue || select.value || "";
    const unique = [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + unique.map((value) => `<option value="${escapeHtml(value)}" ${String(current) === String(value) ? "selected" : ""}>${escapeHtml(formatter(value))}</option>`).join("");
  }

  function currentDocaLabel(item) {
    return item?.doca?.codigo || item?.doca || "A DEFINIR";
  }

  function docaSelectOptions(selectedValue = "") {
    return `<option value="">Selecione a doca</option>` + (state.docaOptions || []).map((doca) => {
      const value = String(doca.id || "");
      const selected = String(selectedValue) === value || String(selectedValue) === String(doca.codigo || "");
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(doca.codigo || `Doca ${value}`)}</option>`;
    }).join("");
  }

  function parseOperationReference(rawValue) {
    const raw = String(rawValue || "").replace(/[​-‍﻿]/g, '').trim();
    if (!raw) return { token: "", id: "" };
    const decoded = (() => {
      try { return decodeURIComponent(raw); } catch { return raw; }
    })();
    let token = "";
    let id = "";
    try {
      const url = decoded.startsWith("http://") || decoded.startsWith("https://") ? new URL(decoded) : new URL(decoded, window.location.origin);
      token = String(url.searchParams.get("token") || "").trim();
      id = String(url.searchParams.get("id") || "").trim();
      if (!token) {
        const pathToken = url.pathname.match(/\/(?:checkin|checkout)\/([^/?#]+)/i);
        if (pathToken?.[1]) token = String(pathToken[1]).trim();
      }
    } catch {}
    if (!token) {
      const match = decoded.match(/(?:^|[?&])token=([^&#]+)/i);
      if (match?.[1]) {
        try { token = decodeURIComponent(match[1]).trim(); } catch { token = String(match[1]).trim(); }
      }
    }
    if (!id) {
      const idMatch = decoded.match(/(?:^|[?&])id=(\d+)/i);
      if (idMatch?.[1]) id = String(idMatch[1]).trim();
    }
    if (!token) {
      const tokenMatch = decoded.match(/(?:CHK|OUT|FOR|MOT)-[A-Z0-9]+-[A-Z0-9]+/i);
      if (tokenMatch?.[0]) token = String(tokenMatch[0]).trim().toUpperCase();
    }
    token = String(token || decoded).replace(/[\s\n\r"'`]+/g, "").trim();
    return { token, id: String(id || '').replace(/\D/g, '').trim() };
  }

  function normalizeOperationToken(rawValue) {
    return parseOperationReference(rawValue).token;
  }

  function applyCheckinRouteContext({ autoValidate = false } = {}) {
    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    const rawToken = params.get("token") || "";
    if (!["checkin", "checkout"].includes(view) || !rawToken) return false;
    const token = normalizeOperationToken(rawToken);
    const form = byId("checkinForm");
    const tokenInput = form?.querySelector('[name="token"]');
    const modoInput = form?.querySelector('[name="modo"]');
    if (tokenInput) tokenInput.value = token;
    if (modoInput) modoInput.value = view === "checkout" ? "checkout" : "checkin";
    showView("checkin");
    if (autoValidate && token) {
      validateCheckin(token).catch(() => {});
    }
    return true;
  }

  function renderPublicResult(data, mode = "consulta") {
    if (!data) return "";
    const links = data.links || {};
    const allowCancel = mode === "motorista" && data.cancelamento?.allowed;
    return `
      <div class="result-grid">
        <div class="result-card">
          <div class="row between wrap gap8">
            <h3>Agendamento ${escapeHtml(data.protocolo || "")}</h3>
            ${renderStatusBadge(data.status, data.semaforo)}
          </div>
          <div class="kv-grid mt12">
            <div><span>Fornecedor</span><strong>${escapeHtml(data.fornecedor || "-")}</strong></div>
            <div><span>Transportadora</span><strong>${escapeHtml(data.transportadora || "-")}</strong></div>
            <div><span>Motorista</span><strong>${escapeHtml(data.motorista || "-")}</strong></div>
            <div><span>Placa</span><strong>${escapeHtml(data.placa || "-")}</strong></div>
            <div><span>Data</span><strong>${escapeHtml(formatDateBR(data.dataAgendada) || "-")}</strong></div>
            <div><span>Hora</span><strong>${escapeHtml(formatHour(data.horaAgendada) || "-")}</strong></div>
            <div><span>Doca</span><strong>${escapeHtml(data.doca || "A DEFINIR")}</strong></div>
            <div><span>Janela</span><strong>${escapeHtml(data.janela || "-")}</strong></div>
            <div><span>Volumes</span><strong>${escapeHtml(formatDecimalBR(data.quantidadeVolumes ?? 0, 3))}</strong></div>
            <div><span>Notas</span><strong>${escapeHtml(formatIntegerBR(data.quantidadeNotas ?? 0))}</strong></div>
            ${mode === "motorista" ? `<div><span>Token do motorista</span><strong>${escapeHtml(data.publicTokenMotorista || "-")}</strong></div>` : `<div><span>Token de consulta</span><strong>${escapeHtml(data.publicTokenFornecedor || "-")}</strong></div>`}
            <div><span>Check-in</span><strong>${escapeHtml(data.checkinToken || "-")}</strong></div>
          </div>
          ${data.observacoes ? `<div class="mt12"><span class="field-label">Observações</span><div class="info-box mt12">${escapeHtml(data.observacoes)}</div></div>` : ""}
        </div>
        <div class="result-card">
          <h3>Ações e links</h3>
          <div class="public-actions mt12">
            ${links.consulta ? `<a class="btn-link" href="${links.consulta}">Consulta da transportadora/fornecedor</a>` : ""}
            ${links.motorista ? `<a class="btn-link" href="${links.motorista}">Acompanhamento do motorista</a>` : ""}
            ${links.voucher ? `<a class="btn-link" href="${links.voucher}" target="_blank" rel="noreferrer">Voucher PDF</a>` : ""}
          </div>
          ${mode === "motorista" ? `<div class="mt16"><span class="field-label">Cancelamento</span><div class="info-box mt12">${escapeHtml(data.cancelamento?.reason || "")}</div>${allowCancel ? `<button type="button" id="btnCancelarMotorista" class="mt12">Cancelar agendamento</button>` : ""}</div>` : ""}
        </div>
        <div class="result-card result-card-full">
          <h3>Notas fiscais</h3>
          ${renderNotasTable(data.notasFiscais)}
        </div>
      </div>
    `;
  }

  function parseJwt(token) {
    try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
  }

  function isTokenExpired(token) {
    const data = parseJwt(token);
    if (!data?.exp) return false;
    return Date.now() >= data.exp * 1000;
  }

  function syncCurrentUserFromToken() {
    if (!state.token || isTokenExpired(state.token)) {
      state.currentUser = null;
      return null;
    }
    const payload = parseJwt(state.token) || {};
    state.currentUser = {
      id: payload.sub || null,
      nome: payload.nome || "",
      perfil: payload.perfil || "",
      permissions: Array.isArray(payload.permissions) ? payload.permissions : []
    };
    return state.currentUser;
  }

  function currentProfile() {
    return String(state.currentUser?.perfil || syncCurrentUserFromToken()?.perfil || "").toUpperCase();
  }

  function getCurrentPermissions() {
    // Always use the frontend PROFILE_PERMISSIONS table so a deploy update
    // is reflected immediately without requiring re-login.
    const fromProfile = PROFILE_PERMISSIONS[currentProfile()];
    if (fromProfile) return fromProfile;
    // Fallback: token-embedded permissions (custom/legacy profile)
    const user = state.currentUser || syncCurrentUserFromToken();
    const explicit = Array.isArray(user?.permissions) ? user.permissions : [];
    return [...new Set(explicit.map((item) => String(item || '').trim()).filter(Boolean))];
  }

  function hasPermission(permission) {
    return getCurrentPermissions().includes(String(permission || '').trim());
  }

  function canAccessView(viewId) {
    const permission = VIEW_PERMISSIONS[viewId];
    return !permission || hasPermission(permission);
  }

  function canAccessCadastroTab(tipo) {
    const permission = CADASTRO_TAB_PERMISSIONS[String(tipo || '').trim()];
    return !permission || hasPermission(permission);
  }

  function firstAllowedPrivateView() {
    const candidates = ["dashboard", "docas", "agendamentos", "confirmacoes", "consulta-nf", "checkin", "cadastros"];
    // "checkin" has no VIEW_PERMISSIONS entry so canAccessView returns true for everyone;
    // place it last so authenticated profiles with real views land there first.
    return candidates.find((viewId) => canAccessView(viewId) && (VIEW_PERMISSIONS[viewId] ? hasPermission(VIEW_PERMISSIONS[viewId]) : false))
      || (hasPermission('agendamentos.checkin') ? 'checkin' : 'public-home');
  }

  function isAdmin() {
    return currentProfile() === "ADMIN";
  }

  function syncFormPermission(form, enabled) {
    if (!form) return;
    form.classList.toggle('readonly-form', !enabled);
    form.querySelectorAll('input, select, textarea, button').forEach((field) => {
      if (field.dataset && field.dataset.keepEnabled === 'true') return;
      if (field.type === 'hidden') return;
      field.disabled = !enabled;
    });
  }

  function applyRoleAccess() {
    document.querySelectorAll('#privateNav [data-view]').forEach((btn) => {
      btn.classList.toggle('hidden', !canAccessView(btn.dataset.view));
    });

    document.querySelectorAll('.cad-tab[data-tipo]').forEach((btn) => {
      const allowed = canAccessCadastroTab(btn.dataset.tipo);
      btn.classList.toggle('hidden', !allowed);
      btn.disabled = !allowed;
    });

    if (!canAccessCadastroTab(state.cadastroTipo)) {
      const firstVisibleTab = [...document.querySelectorAll('.cad-tab[data-tipo]')].find((btn) => !btn.classList.contains('hidden'));
      state.cadastroTipo = firstVisibleTab?.dataset?.tipo || 'fornecedores';
      setActiveButton('.cad-tab', firstVisibleTab || document.querySelector('.cad-tab[data-tipo="fornecedores"]'));
      renderCadastroForm();
      loadCadastro().catch(() => {});
    }

    const canManageCadastros = hasPermission('cadastros.manage') && (state.cadastroTipo !== 'usuarios' || hasPermission('users.manage'));
    const saveCadastroBtn = byId('saveCadastro');
    const novoCadastroBtn = byId('btnNovoCadastro');
    if (saveCadastroBtn) saveCadastroBtn.classList.toggle('hidden', !canManageCadastros);
    if (novoCadastroBtn) novoCadastroBtn.classList.toggle('hidden', !canManageCadastros);
    syncFormPermission(byId('cadastroForm'), canManageCadastros);

    const canCreateAgendamento = hasPermission('agendamentos.create');
    syncFormPermission(byId('agendamentoForm'), canCreateAgendamento);
    const agendamentoSubmit = byId('agendamentoForm')?.querySelector('button[type="submit"]');
    if (agendamentoSubmit) agendamentoSubmit.classList.toggle('hidden', !canCreateAgendamento);

    const actionPermissions = {
      btnAprovar: 'agendamentos.approve',
      btnReprovar: 'agendamentos.reprove',
      btnReagendar: 'agendamentos.reschedule',
      btnCancelar: 'agendamentos.cancel',
      btnEditarAgendamento: 'confirmacoes.view',
      btnIniciar: 'agendamentos.start',
      btnFinalizar: 'agendamentos.finish',
      btnNoShow: 'agendamentos.no_show',
      btnVoucher: 'agendamentos.view',
      btnQr: 'agendamentos.view',
      btnEnviarInfos: 'agendamentos.notify',
      btnResumoFinanceiro: 'financeiro.summary',
      loadAgendamentos: 'confirmacoes.view',
      loadDashboard: 'dashboard.view',
      loadDocas: 'docas.view'
    };
    Object.entries(actionPermissions).forEach(([id, permission]) => {
      const el = byId(id);
      if (!el) return;
      const allowed = hasPermission(permission);
      el.classList.toggle('hidden', !allowed);
      el.disabled = !allowed;
    });

    const checkinAllowed = hasPermission('agendamentos.checkin');
    [byId('checkinForm'), byId('startCamera'), byId('stopCamera')].forEach((el) => {
      if (!el) return;
      if (el.tagName === 'FORM') syncFormPermission(el, checkinAllowed);
      else {
        el.classList.toggle('hidden', !checkinAllowed);
        el.disabled = !checkinAllowed;
      }
    });
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min} min atrás`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}h atrás`;
    return `${Math.floor(h / 24)}d atrás`;
  }

  async function loadNotificacoes() {
    if (!state.token || isTokenExpired(state.token)) return;
    try {
      const data = await api('/api/notificacoes');
      state.notificacoes = Array.isArray(data) ? data : [];
      renderNotifBadge();
    } catch { /* silencioso */ }
  }

  function renderNotifBadge() {
    const badge = byId('notifBadge');
    const unread = state.notificacoes.filter((n) => !n.lida).length;
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
  }

  function renderNotifDropdown() {
    const drop = byId('notifDropdown');
    if (!drop) return;
    const notifs = state.notificacoes;
    drop.innerHTML = `
      <div class="notif-header">
        <span>Notificações</span>
        <button type="button" id="btnFecharNotif" style="background:none;border:none;color:#64748b;font-size:18px;cursor:pointer;padding:0">✕</button>
      </div>
      ${!notifs.length ? '<div class="notif-empty">Nenhuma notificação.</div>' : notifs.map((n) => `
        <div class="notif-item ${n.lida ? '' : 'unread'}" data-notif-id="${n.id}" data-agendamento-id="${n.agendamentoId || ''}">
          <div class="notif-item-title">${n.tipo === 'SOLICITAR_REAGENDAMENTO' ? '🔔 Reagendamento solicitado' : escapeHtml(n.tipo || '')}</div>
          <div class="notif-item-sub">${escapeHtml(n.protocolo || '-')} — ${escapeHtml(n.fornecedor || '-')}</div>
          <div class="notif-item-sub">Data original: <strong>${escapeHtml(formatDateBR(n.dataAgendadaOriginal) || '-')}</strong> | Por: ${escapeHtml(n.requestedBy?.nome || n.requestedBy?.perfil || '-')}</div>
          <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
        </div>`).join('')}
    `;
    drop.querySelectorAll('.notif-item').forEach((el) => {
      el.addEventListener('click', async () => {
        const notifId = el.dataset.notifId;
        const agendamentoId = el.dataset.agendamentoId;
        await api(`/api/notificacoes/${notifId}/lida`, { method: 'PATCH' }).catch(() => {});
        const idx = state.notificacoes.findIndex((n) => String(n.id) === String(notifId));
        if (idx >= 0) state.notificacoes[idx].lida = true;
        renderNotifBadge();
        if (agendamentoId && hasPermission('agendamentos.reschedule')) {
          abrirModalReagendamentoNotif(notifId, agendamentoId, el);
        }
        drop.classList.add('hidden');
      });
    });
    byId('btnFecharNotif')?.addEventListener('click', (e) => { e.stopPropagation(); drop.classList.add('hidden'); });
  }

  function abrirModalReagendamentoNotif(notifId, agendamentoId, itemEl) {
    const existing = byId('modalReagendamentoNotif');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'modalReagendamentoNotif';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:600;padding:16px';
    const protocolo = itemEl?.querySelector('.notif-item-sub')?.textContent?.split('—')[0]?.trim() || `ID ${agendamentoId}`;
    modal.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:28px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25)">
        <h3 style="margin:0 0 16px">Reagendar agendamento</h3>
        <p style="margin:0 0 12px;font-size:14px;color:#475569">${escapeHtml(protocolo)}</p>
        <label style="display:grid;gap:6px;font-size:14px;font-weight:600">Nova data
          <input id="novaDataReagendamento" type="date" style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px" />
        </label>
        <label style="display:grid;gap:6px;font-size:14px;font-weight:600;margin-top:12px">Nova hora (HH:MM)
          <input id="novaHoraReagendamento" type="text" placeholder="08:00" style="padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px" />
        </label>
        <p id="modalReagendNotifMsg" style="margin:10px 0 0;font-size:13px;color:#ef4444"></p>
        <div style="display:flex;gap:10px;margin-top:20px">
          <button id="btnConfirmarReagendNotif" style="flex:1;padding:12px;border-radius:12px;font-weight:700">Confirmar</button>
          <button id="btnCancelarReagendNotif" style="flex:1;background:#475569;padding:12px;border-radius:12px">Cancelar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    byId('btnCancelarReagendNotif').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    byId('btnConfirmarReagendNotif').onclick = async () => {
      const novaData = byId('novaDataReagendamento').value;
      const novaHora = byId('novaHoraReagendamento').value.trim();
      const msg = byId('modalReagendNotifMsg');
      if (!novaData) { msg.textContent = 'Informe a nova data.'; return; }
      try {
        await api(`/api/agendamentos/${agendamentoId}/reagendar`, { method: 'POST', body: JSON.stringify({ dataAgendada: novaData, horaAgendada: novaHora || undefined }) });
        modal.remove();
        await loadNotificacoes();
        if (document.querySelector('#confirmacoes.view.active')) loadAgendamentos().catch(() => {});
      } catch (err) { msg.textContent = err.message || 'Erro ao reagendar.'; }
    };
  }

  function startNotifPolling() {
    if (state.notifPollInterval) return;
    loadNotificacoes();
    state.notifPollInterval = setInterval(() => loadNotificacoes(), 30000);
  }

  function stopNotifPolling() {
    if (state.notifPollInterval) { clearInterval(state.notifPollInterval); state.notifPollInterval = null; }
  }

  function logout() {
    stopNotifPolling();
    localStorage.removeItem("token");
    state.token = "";
    state.currentUser = null;
    if (typeof refreshWatermark === 'function') refreshWatermark();
    updateNav();
    showView("public-home");
  }

  function updateNav() {
    const logged = !!state.token && !isTokenExpired(state.token);
    if (logged) syncCurrentUserFromToken();
    byId("publicNav")?.classList.toggle("hidden", logged);
    byId("privateNav")?.classList.toggle("hidden", !logged);
    applyRoleAccess();
    if (logged) {
      const activeView = document.querySelector('.view.active')?.id || '';
      if (activeView && !canAccessView(activeView)) showView(firstAllowedPrivateView());
    }
    if (!logged && state.token) logout();
  }

  async function api(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (state.token && !isTokenExpired(state.token)) {
      headers.Authorization = `Bearer ${state.token}`;
    }
    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch {
      throw new Error("A API não respondeu. Verifique se o backend está iniciado.");
    }
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (res.status === 401) logout();
    if (!res.ok) {
      const html503 = !ct.includes('application/json') && res.status >= 500 && /503|service unavailable/i.test(String(data || ''));
      const message = html503 ? 'O servidor retornou 503 ao processar a operação.' : (data?.message || data || 'Erro na requisição');
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function setActiveButton(selector, activeButton) {
    document.querySelectorAll(selector).forEach((btn) => btn.classList.remove("active"));
    activeButton?.classList.add("active");
  }

  function showView(id) {
    const logged = !!state.token && !isTokenExpired(state.token);
    let target = id;
    if (logged && !canAccessView(target)) target = firstAllowedPrivateView();
    if (!logged && VIEW_PERMISSIONS[target]) target = 'login';

    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    byId(target)?.classList.add("active");
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === target);
    });

    if (target === 'confirmacoes' && logged) {
      loadAgendamentos().catch(() => {});
      loadAuditoria().catch(() => {});
    }
  }

  function ensureModalHost() {
    let host = byId('appModalHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'appModalHost';
    host.className = 'app-modal hidden';
    host.innerHTML = `
      <div class="app-modal-backdrop" data-modal-close></div>
      <div class="app-modal-card">
        <div class="app-modal-header">
          <h3 id="appModalTitle">Aviso</h3>
        </div>
        <div id="appModalBody" class="app-modal-body"></div>
        <div class="app-modal-actions">
          <button type="button" id="appModalCancel" class="btn-secondary hidden">Cancelar</button>
          <button type="button" id="appModalConfirm">OK</button>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    return host;
  }

  function showAppModal({ title = 'Aviso', message = '', confirmText = 'OK', cancelText = '', tone = 'info' } = {}) {
    const host = ensureModalHost();
    const titleEl = byId('appModalTitle');
    const bodyEl = byId('appModalBody');
    const confirmBtn = byId('appModalConfirm');
    const cancelBtn = byId('appModalCancel');
    if (!titleEl || !bodyEl || !confirmBtn || !cancelBtn) return Promise.resolve(false);
    titleEl.textContent = title;
    bodyEl.innerHTML = `<div class="app-modal-tone app-modal-tone-${escapeHtml(tone)}"></div><div>${String(message || '').split('\n').map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div>`;
    confirmBtn.textContent = confirmText || 'OK';
    cancelBtn.textContent = cancelText || 'Cancelar';
    cancelBtn.classList.toggle('hidden', !cancelText);
    host.classList.remove('hidden');
    document.body.classList.add('modal-open');
    return new Promise((resolve) => {
      const cleanup = (result) => {
        host.classList.add('hidden');
        document.body.classList.remove('modal-open');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = null; });
        resolve(result);
      };
      confirmBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = () => cleanup(false); });
    });
  }


  function showHtmlModal({ title = 'Detalhes', html = '', confirmText = 'Fechar', cancelText = '', wide = false } = {}) {
    const host = ensureModalHost();
    const titleEl = byId('appModalTitle');
    const bodyEl = byId('appModalBody');
    const confirmBtn = byId('appModalConfirm');
    const cancelBtn = byId('appModalCancel');
    const card = host?.querySelector('.app-modal-card');
    if (!titleEl || !bodyEl || !confirmBtn || !cancelBtn || !card) return Promise.resolve(false);
    titleEl.textContent = title;
    bodyEl.classList.add('app-modal-body-html');
    bodyEl.innerHTML = html || '<p>Nenhum detalhe disponível.</p>';
    confirmBtn.textContent = confirmText || 'Fechar';
    cancelBtn.textContent = cancelText || 'Cancelar';
    cancelBtn.classList.toggle('hidden', !cancelText);
    card.classList.toggle('app-modal-card-wide', !!wide);
    host.classList.remove('hidden');
    document.body.classList.add('modal-open');
    return new Promise((resolve) => {
      const cleanup = (result) => {
        host.classList.add('hidden');
        document.body.classList.remove('modal-open');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        card.classList.remove('app-modal-card-wide');
        host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = null; });
        resolve(result);
      };
      confirmBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
      host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = () => cleanup(false); });
    });
  }

  // ── Modal de edição inline de agendamento (PENDENTE_APROVACAO) ───────────────
  async function openInlineEditModal(item) {
    // Fetch available docas for the select
    let docas = [];
    try { docas = await api('/api/cadastros/docas'); } catch (_e) {}

    const docaSelect = docas.length
      ? `<div class="form-group">
           <label>Doca</label>
           <select id="ieDocaId">
             <option value="">— manter atual —</option>
             ${docas.map((d) => `<option value="${d.id}" ${Number(item.docaId) === Number(d.id) ? 'selected' : ''}>${escapeHtml(d.codigo || d.descricao || String(d.id))}</option>`).join('')}
           </select>
         </div>`
      : '';

    const html = `
      <div class="form-grid" style="gap:12px;margin-top:4px">
        <div class="form-group">
          <label>Transportadora</label>
          <input id="ieTransportadora" type="text" value="${escapeHtml(item.transportadora || '')}" placeholder="Nome da transportadora" />
        </div>
        <div class="form-group">
          <label>Motorista</label>
          <input id="ieMotorista" type="text" value="${escapeHtml(item.motorista || '')}" placeholder="Nome do motorista" />
        </div>
        <div class="form-group">
          <label>CPF Motorista</label>
          <input id="ieCpfMotorista" type="text" value="${escapeHtml(item.cpfMotorista || '')}" placeholder="000.000.000-00" />
        </div>
        <div class="form-group">
          <label>Placa</label>
          <input id="iePlaca" type="text" value="${escapeHtml(item.placa || '')}" placeholder="ABC-1234" />
        </div>
        <div class="form-group">
          <label>Telefone motorista</label>
          <input id="ieTelefone" type="text" value="${escapeHtml(item.telefoneMotorista || '')}" placeholder="(00) 00000-0000" />
        </div>
        <div class="form-group">
          <label>Data agendada</label>
          <input id="ieData" type="date" value="${escapeHtml(item.dataAgendada || '')}" />
        </div>
        <div class="form-group">
          <label>Hora agendada</label>
          <input id="ieHora" type="time" value="${escapeHtml(item.horaAgendada || '')}" />
        </div>
        ${docaSelect}
        <div class="form-group form-group-full">
          <label>Observações</label>
          <input id="ieObs" type="text" value="${escapeHtml(item.observacoes || '')}" placeholder="Informações adicionais" />
        </div>
      </div>
      <p id="ieMsgErr" style="color:#ef4444;font-size:13px;margin:8px 0 0;min-height:18px"></p>`;

    const ok = await showHtmlModal({
      title: `Editar agendamento — ${escapeHtml(item.protocolo || String(item.id))}`,
      html,
      confirmText: 'Salvar alterações',
      cancelText: 'Cancelar',
      wide: true
    });
    if (!ok) return;

    // Collect values (modal is hidden but elements are still in DOM)
    const patch = {};
    const pick = (id, key, transform) => {
      const el = byId(id);
      if (!el) return;
      const raw = el.tagName === 'SELECT' ? el.value : (el.value || '').trim();
      if (raw !== '') patch[key] = transform ? transform(raw) : raw;
    };
    pick('ieTransportadora', 'transportadora');
    pick('ieMotorista', 'motorista');
    pick('ieCpfMotorista', 'cpfMotorista');
    pick('iePlaca', 'placa');
    pick('ieTelefone', 'telefoneMotorista');
    pick('ieData', 'dataAgendada');
    pick('ieHora', 'horaAgendada');
    pick('ieObs', 'observacoes');
    pick('ieDocaId', 'docaId', Number);

    if (!Object.keys(patch).length) return;

    try {
      await api(`/api/agendamentos/${item.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      const msgEl = byId('operacaoMsg');
      if (msgEl) msgEl.textContent = 'Agendamento atualizado com sucesso.';
      await Promise.allSettled([loadAgendamentos(), loadDashboard()]);
    } catch (err) {
      const msgEl = byId('operacaoMsg');
      if (msgEl) msgEl.textContent = err.message || 'Erro ao salvar.';
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  function buildMultipartFormData(payload = {}) {
    const form = new FormData();
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (value == null) return;
      if (value instanceof File) {
        form.append(key, value);
        return;
      }
      if (value instanceof FileList) {
        Array.from(value).forEach((item) => {
          if (item instanceof File) form.append(key, item);
        });
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => {
          if (item instanceof File) {
            form.append(key, item);
            return;
          }
          if (item == null) return;
          form.append(key, typeof item === 'object' ? JSON.stringify(item) : String(item));
        });
        return;
      }
      if (typeof value === 'object') {
        form.append(key, JSON.stringify(value));
        return;
      }
      form.append(key, String(value));
    });
    return form;
  }

  async function showCheckoutCompletionForm({ title = 'Concluir operação', contextLabel = 'Finalize o recebimento.', notasFiscais = [] } = {}) {
    const host = ensureModalHost();
    const titleEl = byId('appModalTitle');
    const bodyEl = byId('appModalBody');
    const confirmBtn = byId('appModalConfirm');
    const cancelBtn = byId('appModalCancel');
    const card = host?.querySelector('.app-modal-card');
    if (!titleEl || !bodyEl || !confirmBtn || !cancelBtn || !card) return null;
    titleEl.textContent = title;
    card.classList.add('app-modal-card-wide');
    bodyEl.classList.add('app-modal-body-html');

    const notaOptions = (() => {
      const source = Array.isArray(notasFiscais) ? notasFiscais : [];
      const normalized = source.map((nota, index) => {
        const numeroNf = String(nota?.numeroNf || nota?.numero || '').trim();
        const serie = String(nota?.serie || '').trim();
        const chaveAcesso = String(nota?.chaveAcesso || nota?.chave || '').trim();
        const destino = String(nota?.destino || nota?.empresa || '').trim();
        const key = [numeroNf || `sem-numero-${index}`, serie, chaveAcesso || destino].filter(Boolean).join('||');
        const label = [numeroNf ? `NF ${numeroNf}` : `NF ${index + 1}`, serie ? `Série ${serie}` : '', destino].filter(Boolean).join(' • ');
        return { key, numeroNf, serie, chaveAcesso, destino, label: label || `NF ${index + 1}` };
      }).filter((nota) => nota.key);
      return normalized.filter((nota, index, arr) => arr.findIndex((item) => item.key === nota.key) === index);
    })();
    const notaOptionsMap = new Map(notaOptions.map((nota) => [nota.key, nota]));
    const mustSelectNotas = notaOptions.length > 1;
    const notaSummaryHtml = notaOptions.length
      ? `
        <div class="checkout-note-summary">
          <div class="checkout-note-summary-header">
            <strong>Notas fiscais disponíveis</strong>
            <span>${mustSelectNotas ? 'Selecione uma ou mais notas em cada ocorrência.' : 'A NF única já ficará pré-selecionada no item.'}</span>
          </div>
          <div class="checkout-note-pill-list">
            ${notaOptions.map((nota) => `<span class="checkout-note-pill">${escapeHtml(nota.label)}</span>`).join('')}
          </div>
        </div>
      `
      : `
        <div class="checkout-note-summary checkout-note-summary-empty">
          <div class="checkout-note-summary-header">
            <strong>Notas fiscais</strong>
            <span>Nenhuma NF foi encontrada para vincular automaticamente nesta ocorrência.</span>
          </div>
        </div>
      `;

    bodyEl.innerHTML = `
      <form id="checkoutCompletionForm" class="checkout-form-layout">
        <div class="checkout-form-intro">${escapeHtml(contextLabel)}</div>

        <section class="checkout-form-section checkout-form-section-primary">
          <div class="checkout-form-section-header">
            <div>
              <strong>Resumo do recebimento</strong>
              <span>Preencha primeiro a situação geral da descarga.</span>
            </div>
          </div>
          <div class="checkout-form-grid checkout-form-grid-main">
            <label class="checkout-field checkout-field-full checkout-field-textarea">Observação do assistente
              <textarea name="observacaoAssistente" rows="4" placeholder="Descreva o que ocorreu na descarga."></textarea>
            </label>
            <label class="checkout-field">Como foi a descarga?
              <select name="comoFoiDescarga">
                <option value="Concluída sem ocorrência">Concluída sem ocorrência</option>
                <option value="Concluída com ressalvas">Concluída com ressalvas</option>
                <option value="Parcial">Parcial</option>
              </select>
            </label>
            <label class="checkout-field checkout-field-highlight">Houve avaria?
              <select name="houveAvaria" id="checkoutAvariaSelect">
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>
            <label class="checkout-field">Motorista tranquilo?
              <select name="motoristaTranquilo">
                <option value="">Selecione</option>
                <option value="SIM">Sim</option>
                <option value="NAO">Não</option>
              </select>
            </label>
            <label class="checkout-field">Carga batida?
              <select name="cargaBatida">
                <option value="">Selecione</option>
                <option value="SIM">Sim</option>
                <option value="NAO">Não</option>
              </select>
            </label>
          </div>
        </section>

        <section class="checkout-form-section checkout-form-section-warning hidden" id="checkoutAvariaFields">
          <div class="checkout-form-section-header">
            <div>
              <strong>Detalhamento da avaria</strong>
              <span>Informe o tipo, a origem do recebimento, os produtos afetados e as notas relacionadas.</span>
            </div>
            <button type="button" id="checkoutAddAvariaItem" class="btn-secondary checkout-inline-action">Adicionar produto</button>
          </div>

          <div class="checkout-form-grid checkout-form-grid-secondary">
            <label class="checkout-field">Tipo de avaria
              <select name="tipoAvaria" id="checkoutTipoAvaria">
                <option value="">Selecione</option>
                <option value="PRODUTO FALTANDO DENTRO DOS VOLUMES">PRODUTO FALTANDO DENTRO DOS VOLUMES</option>
                <option value="PRODUTO AVARIADO/DANIFICADO">PRODUTO AVARIADO/DANIFICADO</option>
                <option value="PRODUTO EM DESACORDO/TROCADO">PRODUTO EM DESACORDO/TROCADO</option>
                <option value="FALTANDO VOLUMES">FALTANDO VOLUMES</option>
              </select>
            </label>
            <label class="checkout-field">Recebido em
              <select name="origemRecebimento" id="checkoutOrigemRecebimento">
                <option value="">Selecione</option>
                <option value="MATRIZ">1 - MATRIZ</option>
                <option value="FILIAL">2 - FILIAL</option>
              </select>
            </label>
            <label class="checkout-field checkout-field-full">Observação geral da avaria
              <textarea name="observacaoAvaria" rows="3" placeholder="Detalhes complementares da ocorrência."></textarea>
            </label>
          </div>

          ${notaSummaryHtml}

          <div class="checkout-products-block">
            <div class="checkout-products-title">Produtos com avaria</div>
            <div id="checkoutAvariaItems" class="checkout-products-list"></div>
          </div>

          <label class="checkout-field checkout-field-full">Imagens da avaria
            <input name="imagensAvaria" type="file" accept="image/*" capture="environment" multiple />
          </label>
        </section>
      </form>
    `;
    confirmBtn.textContent = 'Concluir';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.classList.remove('hidden');
    host.classList.remove('hidden');
    document.body.classList.add('modal-open');
    const avariaSelect = byId('checkoutAvariaSelect');
    const avariaFields = byId('checkoutAvariaFields');
    const avariaItemsContainer = byId('checkoutAvariaItems');
    const addAvariaItemBtn = byId('checkoutAddAvariaItem');

    const buildNotaSelectorHtml = () => {
      if (!notaOptions.length) return '';
      return `
        <div class="checkout-field checkout-field-full">
          <span>Notas fiscais vinculadas</span>
          <div class="checkout-note-chip-grid">
            ${notaOptions.map((nota) => `
              <label class="checkout-note-chip">
                <input type="checkbox" name="avariaNotaSelecionada" value="${escapeHtml(nota.key)}" ${notaOptions.length === 1 ? 'checked' : ''} />
                <span>${escapeHtml(nota.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    };

    const buildAvariaItemRow = (index) => `
      <article class="checkout-avaria-item-row" data-avaria-index="${index}">
        <div class="checkout-avaria-item-header">
          <strong>Produto ${index + 1}</strong>
          <button type="button" class="btn-secondary checkout-remove-avaria-item">Remover</button>
        </div>
        <div class="checkout-avaria-item-grid">
          <label class="checkout-field">Produto
            <input name="avariaProduto" placeholder="Informe o produto" />
          </label>
          <label class="checkout-field checkout-field-compact">Quantidade
            <input name="avariaQuantidade" type="number" min="1" step="1" placeholder="0" />
          </label>
          ${buildNotaSelectorHtml()}
          <label class="checkout-field checkout-field-full">Observação do produto
            <textarea name="avariaObservacao" rows="2" placeholder="Detalhe específico deste produto, se houver."></textarea>
          </label>
        </div>
      </article>
    `;

    const ensureAvariaItemRow = () => {
      if (!avariaItemsContainer) return;
      if (avariaItemsContainer.children.length > 0) return;
      avariaItemsContainer.insertAdjacentHTML('beforeend', buildAvariaItemRow(0));
      const firstRemoveBtn = avariaItemsContainer.querySelector('.checkout-remove-avaria-item');
      if (firstRemoveBtn) firstRemoveBtn.disabled = true;
    };

    const refreshAvariaRowsState = () => {
      if (!avariaItemsContainer) return;
      const rows = Array.from(avariaItemsContainer.querySelectorAll('.checkout-avaria-item-row'));
      rows.forEach((row, index) => {
        row.dataset.avariaIndex = String(index);
        const title = row.querySelector('.checkout-avaria-item-header strong');
        if (title) title.textContent = `Produto ${index + 1}`;
        const removeBtn = row.querySelector('.checkout-remove-avaria-item');
        if (removeBtn) removeBtn.disabled = rows.length === 1;
      });
    };

    const collectAvariaItems = () => {
      if (!avariaItemsContainer) return [];
      return Array.from(avariaItemsContainer.querySelectorAll('.checkout-avaria-item-row')).map((row) => ({
        produto: String(row.querySelector('[name="avariaProduto"]')?.value || '').trim(),
        quantidade: String(row.querySelector('[name="avariaQuantidade"]')?.value || '').trim(),
        observacao: String(row.querySelector('[name="avariaObservacao"]')?.value || '').trim(),
        notas: Array.from(row.querySelectorAll('[name="avariaNotaSelecionada"]:checked')).map((input) => {
          const nota = notaOptionsMap.get(String(input?.value || ''));
          return nota ? { numeroNf: nota.numeroNf, serie: nota.serie, chaveAcesso: nota.chaveAcesso, destino: nota.destino, label: nota.label } : null;
        }).filter(Boolean)
      })).filter((item) => item.produto || item.quantidade || item.observacao || item.notas.length);
    };

    const toggle = () => {
      const enabled = String(avariaSelect?.value || 'nao') === 'sim';
      avariaFields?.classList.toggle('hidden', !enabled);
      if (enabled) ensureAvariaItemRow();
    };

    avariaSelect?.addEventListener('change', toggle);
    addAvariaItemBtn?.addEventListener('click', () => {
      if (!avariaItemsContainer) return;
      avariaItemsContainer.insertAdjacentHTML('beforeend', buildAvariaItemRow(avariaItemsContainer.children.length));
      refreshAvariaRowsState();
    });
    avariaItemsContainer?.addEventListener('click', (event) => {
      const removeBtn = event.target?.closest('.checkout-remove-avaria-item');
      if (!removeBtn) return;
      const row = removeBtn.closest('.checkout-avaria-item-row');
      if (!row) return;
      if (avariaItemsContainer.querySelectorAll('.checkout-avaria-item-row').length <= 1) return;
      row.remove();
      refreshAvariaRowsState();
    });
    toggle();
    refreshAvariaRowsState();

    return new Promise((resolve) => {
      const cleanup = (result) => {
        host.classList.add('hidden');
        document.body.classList.remove('modal-open');
        confirmBtn.onclick = null;
        cancelBtn.onclick = null;
        card.classList.remove('app-modal-card-wide');
        host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = null; });
        resolve(result);
      };
      confirmBtn.onclick = () => {
        const form = byId('checkoutCompletionForm');
        if (!form) return cleanup(null);
        const fd = new FormData(form);
        const houveAvaria = String(fd.get('houveAvaria') || 'nao') === 'sim';
        const avarias = collectAvariaItems();
        if (houveAvaria) {
          const tipoAvaria = String(fd.get('tipoAvaria') || '').trim();
          const origemRecebimento = String(fd.get('origemRecebimento') || '').trim();
          const hasInvalidAvaria = !tipoAvaria
            || !origemRecebimento
            || !avarias.length
            || avarias.some((item) => !item.produto || !item.quantidade || Number(item.quantidade) <= 0 || (notaOptions.length && !item.notas.length));
          if (hasInvalidAvaria) {
            window.alert(notaOptions.length
              ? 'Preencha o tipo da avaria, a origem do recebimento, os produtos com quantidade e vincule ao menos uma nota fiscal em cada ocorrência.'
              : 'Preencha o tipo da avaria, a origem do recebimento e todos os produtos com quantidade.');
            return;
          }
        }
        cleanup({
          comoFoiDescarga: fd.get('comoFoiDescarga') || '',
          observacaoAssistente: fd.get('observacaoAssistente') || '',
          houveAvaria,
          tipoAvaria: fd.get('tipoAvaria') || '',
          origemRecebimento: fd.get('origemRecebimento') || '',
          exigirVinculoNota: mustSelectNotas,
          totalNotasRelacionadas: notaOptions.length,
          avarias,
          itemAvaria: avarias[0]?.produto || '',
          quantidadeAvaria: avarias[0]?.quantidade || '',
          observacaoAvaria: fd.get('observacaoAvaria') || '',
          motoristaTranquilo: fd.get('motoristaTranquilo') || '',
          cargaBatida: fd.get('cargaBatida') || '',
          imagensAvaria: form.querySelector('[name="imagensAvaria"]')?.files || []
        });
      };
      cancelBtn.onclick = () => cleanup(null);
      host.querySelectorAll('[data-modal-close]').forEach((el) => { el.onclick = () => cleanup(null); });
    });
  }

  function tableFromObjects(items) {
    if (!items?.length) return "<p>Nenhum registro.</p>";
    const cols = Object.keys(items[0]).filter((k) => typeof items[0][k] !== "object");
    return `<table class="table"><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${items.map((row) => `<tr>${cols.map((c) => `<td>${escapeHtml(row[c] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function ensureNfDraftSize() {
    while (state.nfDrafts.length < state.nfRows) {
      state.nfDrafts.push({ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" });
    }
    state.nfDrafts = state.nfDrafts.slice(0, state.nfRows);
  }

  function syncNfDraftsFromDom() {
    document.querySelectorAll("[data-nf]").forEach((el) => {
      const idx = Number(el.dataset.nf);
      const field = el.dataset.field;
      state.nfDrafts[idx] ??= { numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" };
      state.nfDrafts[idx][field] = el.value;
    });
  }

  function renderNfRows() {
    const wrap = byId("nfList");
    if (!wrap) return;
    ensureNfDraftSize();
    wrap.innerHTML = "";
    for (let i = 0; i < state.nfRows; i += 1) {
      const row = state.nfDrafts[i] || {};
      const div = document.createElement("div");
      div.className = "grid2 mt12 nf-row";
      div.innerHTML = `
        <label>Número NF<input data-nf="${i}" data-field="numeroNf" value="${escapeHtml(row.numeroNf || "")}" /></label>
        <label>Série<input data-nf="${i}" data-field="serie" value="${escapeHtml(row.serie || "")}" /></label>
        <label>Chave de acesso<input data-nf="${i}" data-field="chaveAcesso" inputmode="numeric" maxlength="44" value="${escapeHtml(row.chaveAcesso || "")}" /></label>
        <label>Volumes<input data-nf="${i}" data-field="volumes" type="number" min="0" value="${escapeHtml(row.volumes ?? "0")}" /></label>
        <label>Peso<input data-nf="${i}" data-field="peso" type="number" min="0" step="0.001" value="${escapeHtml(row.peso ?? "0")}" /></label>
        <label>Valor NF<input data-nf="${i}" data-field="valorNf" type="number" min="0" step="0.01" value="${escapeHtml(row.valorNf ?? "0")}" /></label>
        <label class="nf-full">Observação<textarea data-nf="${i}" data-field="observacao">${escapeHtml(row.observacao || "")}</textarea></label>
      `;
      wrap.appendChild(div);
    }
    wrap.querySelectorAll("[data-nf]").forEach((el) => {
      el.addEventListener("input", () => { syncNfDraftsFromDom(); updateTotalsFromNotas(); });
      el.addEventListener("change", () => { syncNfDraftsFromDom(); updateTotalsFromNotas(); });
    });
  }

  function collectNotas() {
    syncNfDraftsFromDom();
    return state.nfDrafts
      .map((nota) => ({
        numeroNf: String(nota.numeroNf || "").trim(),
        serie: String(nota.serie || "").trim(),
        chaveAcesso: String(nota.chaveAcesso || "").replace(/\D/g, "").trim(),
        volumes: Number(nota.volumes || 0),
        peso: Number(nota.peso || 0),
        valorNf: Number(nota.valorNf || 0),
        observacao: String(nota.observacao || "").trim()
      }))
      .filter((item) => item.numeroNf || item.chaveAcesso);
  }

  function updateTotalsFromNotas() {
    const notas = collectNotas();
    const totalNotas = notas.length;
    const totalVolumes = notas.reduce((acc, item) => acc + Number(item.volumes || 0), 0);
    const totalPeso = notas.reduce((acc, item) => acc + Number(item.peso || 0), 0);
    const totalValor = notas.reduce((acc, item) => acc + Number(item.valorNf || 0), 0);
    const form = byId("fornecedorForm");
    if (!form) return;
    form.querySelector('[name="quantidadeNotas"]').value = formatIntegerBR(totalNotas);
    form.querySelector('[name="quantidadeVolumes"]').value = formatDecimalBR(totalVolumes, 3);
    form.querySelector('[name="pesoTotalKg"]').value = formatDecimalBR(totalPeso, 3);
    form.querySelector('[name="valorTotalNf"]').value = formatDecimalBR(totalValor, 2);
  }


  function getFilteredPublicPendingFornecedores() {
    const term = String(state.publicPendingSearchTerm || '').trim().toLowerCase();
    if (!term) return [...(state.pendingFornecedores || [])];
    return (state.pendingFornecedores || []).filter((item) => {
      const fornecedor = String(item?.fornecedor || item?.nome || '').toLowerCase();
      return fornecedor.includes(term);
    });
  }

  function renderPublicPendingFornecedorOptions() {
    const select = byId('fornecedorPendenteSelect');
    if (!select) return;
    const previous = String(select.value || '').trim();
    const items = getFilteredPublicPendingFornecedores();
    select.innerHTML = `<option value="">Selecionar manualmente</option>` + items.map((item) => `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.fornecedor || item.nome || '-')} (${escapeHtml(item.quantidadeNotas ?? 0)} NF)</option>`).join('');
    const hasPrevious = items.some((item) => String(item?.id || '') === previous);
    select.value = hasPrevious ? previous : '';
  }

  async function loadFornecedoresPendentes() {
    try {
      const items = await api('/api/public/fornecedores-pendentes');
      state.pendingFornecedores = Array.isArray(items) ? items.map(normalizePendingFornecedor) : [];
      const select = byId('fornecedorPendenteSelect');
      if (!select) return;
      renderPublicPendingFornecedorOptions();
      select.onchange = () => {
        const data = getPendingFornecedorById(select.value);
        const form = byId('fornecedorForm');
        if (!data || !form) {
          state.nfRows = 1;
          state.nfDrafts = [{ numeroNf: '', serie: '', chaveAcesso: '', volumes: '0', peso: '0', valorNf: '0', observacao: '' }];
          renderNfRows();
          updateTotalsFromNotas();
          return;
        }
        ['fornecedor', 'transportadora', 'placa'].forEach((field) => {
          if (data[field] && form.querySelector(`[name="${field}"]`)) form.querySelector(`[name="${field}"]`).value = data[field];
        });
        const notas = Array.isArray(data.notas) ? data.notas : [];
        state.nfRows = Math.max(notas.length, 1);
        state.nfDrafts = notas.length
          ? notas.map((n) => ({ numeroNf: n.numeroNf || '', serie: n.serie || '', chaveAcesso: n.chaveAcesso || '', volumes: String(n.volumes || 0), peso: String(n.peso || 0), valorNf: String(n.valorNf || 0), observacao: n.observacao || '' }))
          : [{ numeroNf: '', serie: '', chaveAcesso: '', volumes: '0', peso: '0', valorNf: '0', observacao: '' }];
        renderNfRows();
        updateTotalsFromNotas();
      };
    } catch {}
  }

  async function startCameraScan() {
    const video = byId('qrVideo');
    if (!video || state.scanning) return;
    try {
      state.cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      video.srcObject = state.cameraStream;
      await video.play();
      state.barcodeDetector = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code'] }) : null;
      state.scanning = true;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const loop = async () => {
        if (!state.scanning) return;
        try {
          if (state.barcodeDetector) {
            const codes = await state.barcodeDetector.detect(video);
            if (codes[0]?.rawValue) {
              const tokenInput = byId('checkinForm')?.querySelector('[name="token"]');
              const modoInput = byId('checkinForm')?.querySelector('[name="modo"]');
              const rawValue = String(codes[0].rawValue || '');
              const parsed = parseOperationReference(rawValue);
              if (tokenInput) tokenInput.value = rawValue || parsed.token;
              if (modoInput) modoInput.value = /[?&]view=checkout/i.test(rawValue) || /^OUT-/i.test(parsed.token || '') ? 'checkout' : 'checkin';
              await validateCheckin(rawValue || parsed.token);
              state.scanning = false;
              return;
            }
          } else if (video.readyState >= 2) {
            canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0);
          }
        } catch {}
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      byId('checkinMsg').textContent = 'Câmera ativada.';
    } catch (err) {
      byId('checkinMsg').textContent = err.message || 'Não foi possível acessar a câmera.';
    }
  }

  function stopCameraScan() {
    state.scanning = false;
    if (state.cameraStream) state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
    const video = byId('qrVideo'); if (video) video.srcObject = null;
  }

  function renderPublicSlots(dataSelecionada) {
    const janelaSelect = byId("publicJanelaSelect");
    if (!janelaSelect) return;

    const dia = state.disponibilidadePublica.find((item) => item.data === dataSelecionada);
    const hoje = new Date();
    const hojeIso = hoje.toISOString().slice(0, 10);
    const agora = `${String(hoje.getHours()).padStart(2, '0')}:${String(hoje.getMinutes()).padStart(2, '0')}`;
    const horarios = (dia?.horarios || []).filter((slot) => {
      if (Number(slot.disponivel || 0) <= 0) return false;
      if (String(dataSelecionada || '') !== hojeIso) return true;
      return String(slot.hora || '') > agora;
    });

    if (!horarios.length) {
      janelaSelect.innerHTML = "<option value=''>Sem horários disponíveis</option>";
      return;
    }

    janelaSelect.innerHTML = horarios.map((slot) => `
      <option value="${slot.janelaId}" data-hora="${escapeHtml(slot.hora)}">
        ${escapeHtml(slot.hora)}${slot.horaFim ? ` até ${escapeHtml(slot.horaFim)}` : ""}${slot.descricao ? ` - ${escapeHtml(slot.descricao)}` : ""} (${slot.disponivel} vaga(s))
      </option>
    `).join("");
  }

  function parseDecimalInput(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return 0;
    const normalized = raw.replace(/\./g, '').replace(',', '.');
    const num = Number(normalized);
    return Number.isFinite(num) ? num : 0;
  }

  function getJanelaHoraBySelect(select) {
    const selected = select?.selectedOptions?.[0] || null;
    const dataHora = String(selected?.dataset?.hora || '').trim();
    if (dataHora) return formatHour(dataHora) || dataHora;
    const label = String(selected?.textContent || selected?.label || '').trim();
    const match = label.match(/(\d{2}:\d{2})/);
    return match ? match[1] : '';
  }

  function syncInternalHoraFromJanela() {
    const janelaSelect = byId('internalJanelaSelect');
    const horaInput = byId('agendamentoForm')?.querySelector('[name="horaAgendada"]');
    if (!janelaSelect || !horaInput) return '';
    const hora = getJanelaHoraBySelect(janelaSelect);
    if (hora) horaInput.value = hora;
    return hora;
  }

  async function loadJanelasDisponiveis(dataAgendada, docaId, ignoreId) {
    const sel = byId('internalJanelaSelect');
    if (!sel) return;
    if (!dataAgendada) return;
    try {
      let url = `/api/agendamentos/janelas-disponiveis?dataAgendada=${encodeURIComponent(dataAgendada)}`;
      if (docaId) url += `&docaId=${encodeURIComponent(docaId)}`;
      if (ignoreId) url += `&ignoreId=${encodeURIComponent(ignoreId)}`;
      const janelas = await api(url);
      const currentVal = sel.value;
      const available = Array.isArray(janelas) ? janelas.filter((j) => !j.ocupado) : [];
      if (!available.length) return; // fallback: keep existing options if API returned empty
      sel.innerHTML = available.map((j) => `<option value="${j.id}">${escapeHtml(j.codigo)}</option>`).join('');
      if (currentVal && sel.querySelector(`option[value="${currentVal}"]`)) sel.value = currentVal;
      sel.removeEventListener('change', syncInternalHoraFromJanela);
      sel.addEventListener('change', syncInternalHoraFromJanela);
      syncInternalHoraFromJanela();
    } catch {
      // silently keep existing options on error
    }
  }

  function buildNotasFromLines(text) {
    return String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => ({ numeroNf: line, serie: '', chaveAcesso: '', volumes: 0, peso: 0, valorNf: 0, observacao: '' }));
  }

  function buildInternalNotaKey(nota = {}) {
    const normalized = normalizePendingNota(nota);
    return String(
      normalized.rowHash
      || [
        normalized.fornecedor || normalized.fornecedorGrupo,
        normalized.numeroNf,
        normalized.serie,
        normalized.valorNf,
        normalized.peso,
        normalized.volumes,
        normalized.dataEntrada,
        normalized.destino || normalized.empresa,
        normalized.origemManual ? 'MANUAL' : 'RELATORIO'
      ].join('::')
    ).trim();
  }

  function getSelectedInternalFornecedores() {
    if (Array.isArray(state.internalPendingFornecedores) && state.internalPendingFornecedores.length) {
      return state.internalPendingFornecedores;
    }
    return state.internalPendingFornecedor ? [state.internalPendingFornecedor] : [];
  }

  function getCurrentInternalNotas() {
    return getSelectedInternalFornecedores().flatMap((fornecedor) => {
      const nomeFornecedor = String(fornecedor?.fornecedor || fornecedor?.nome || '').trim();
      const notas = Array.isArray(fornecedor?.notas)
        ? fornecedor.notas
        : Array.isArray(fornecedor?.notasFiscais)
          ? fornecedor.notasFiscais
          : [];
      return notas.map((nota) => ({ ...nota, fornecedor: String(nota?.fornecedor || nomeFornecedor).trim(), fornecedorGrupo: nomeFornecedor }));
    });
  }

  function updateInternalFornecedorDropdownTrigger() {
    const trigger = byId('internalFornecedorDropdownTrigger');
    const hiddenInput = byId('internalFornecedorPendenteSelect');
    const fornecedorField = byId('internalFornecedorNome');
    const clearBtn = byId('btnClearInternalFornecedorSelection');
    const selected = getSelectedInternalFornecedores();
    const ids = selected.map((item) => String(item?.id || '')).filter(Boolean);
    const names = selected.map((item) => String(item?.fornecedor || item?.nome || '').trim()).filter(Boolean);
    if (hiddenInput) hiddenInput.value = ids.join(',');
    if (fornecedorField) fornecedorField.value = names.join(', ');
    if (clearBtn) clearBtn.disabled = !selected.length;
    if (!trigger) return;
    if (!selected.length) {
      trigger.textContent = 'Selecione o fornecedor pendente';
      trigger.classList.remove('is-selected');
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    trigger.classList.add('is-selected');
    trigger.textContent = selected.length === 1
      ? `${names[0]} (${formatIntegerBR(selected[0]?.quantidadeNotas ?? 0)} NF)`
      : `${formatIntegerBR(selected.length)} fornecedores selecionados`;
  }

  function closeInternalFornecedorDropdown() {
    const menu = byId('internalFornecedorDropdownMenu');
    const trigger = byId('internalFornecedorDropdownTrigger');
    menu?.classList.add('hidden');
    trigger?.setAttribute('aria-expanded', 'false');
  }

  function applyPendingFornecedoresInterno(items = []) {
    state.internalPendingFornecedores = Array.isArray(items) ? items : [];
    state.internalPendingFornecedor = state.internalPendingFornecedores.length === 1 ? state.internalPendingFornecedores[0] : (state.internalPendingFornecedores[0] || null);
    updateInternalFornecedorDropdownTrigger();
    renderPendingNotasInterno();
  }

  function clearInternalPendingSelectionState({ keepFornecedor = false } = {}) {
    if (!keepFornecedor) {
      state.internalPendingFornecedor = null;
      state.internalPendingFornecedores = [];
      const dropdownMenu = byId('internalFornecedorDropdownMenu');
      dropdownMenu?.querySelectorAll('input[type="checkbox"][data-fornecedor-id]').forEach((el) => { el.checked = false; });
      updateInternalFornecedorDropdownTrigger();
    }
    state.internalSelectedNotas = [];
    state.internalSelectedNotaKeys = new Set();
    state.internalPendingSearchTerm = '';
    state.internalFornecedorSearchTerm = '';
    const searchInput = byId('internalPendingSearch');
    if (searchInput) searchInput.value = '';
  }

  function renderInternalFornecedorDropdown() {
    const menu = byId('internalFornecedorDropdownMenu');
    const trigger = byId('internalFornecedorDropdownTrigger');
    const wrapper = byId('internalFornecedorDropdown');
    if (!menu || !trigger || !wrapper) return;

    const selectedIds = new Set(getSelectedInternalFornecedores().map((item) => String(item?.id || '')));
    if (!(state.pendingFornecedores || []).length) {
      menu.innerHTML = '<div class="multi-select-empty">Nenhum fornecedor pendente encontrado.</div>';
      updateInternalFornecedorDropdownTrigger();
      return;
    }

    const activeSearchInput = document.activeElement?.id === 'internalFornecedorSearchInput' ? document.activeElement : null;
    const activeSelectionStart = typeof activeSearchInput?.selectionStart === 'number' ? activeSearchInput.selectionStart : null;
    const activeSelectionEnd = typeof activeSearchInput?.selectionEnd === 'number' ? activeSearchInput.selectionEnd : null;
    const fornecedorTerm = String(state.internalFornecedorSearchTerm || '').trim().toLowerCase();
    const fornecedoresVisiveis = fornecedorTerm
      ? state.pendingFornecedores.filter((item) => String(item?.fornecedor || item?.nome || '').toLowerCase().includes(fornecedorTerm))
      : [...state.pendingFornecedores];

    menu.innerHTML = `
      <div class="multi-select-search">
        <input type="text" id="internalFornecedorSearchInput" placeholder="Buscar fornecedor pendente" value="${escapeHtml(state.internalFornecedorSearchTerm || '')}" />
      </div>
      <div style="padding:6px 10px;font-size:11px;color:#64748b;border-bottom:1px solid #f1f5f9">Não encontrou? Adicione manualmente abaixo ↓</div>
      ${fornecedoresVisiveis.map((item) => {
      const id = String(item?.id || '').trim();
      const checked = selectedIds.has(id) ? 'checked' : '';
      const label = `${String(item.fornecedor || item.nome || '-').trim()} (${formatIntegerBR(item.quantidadeNotas ?? 0)} NF)`;
      return `<label class="multi-select-option" data-fornecedor-id="${escapeHtml(id)}"><input type="checkbox" data-fornecedor-id="${escapeHtml(id)}" ${checked} /><span class="multi-select-option-text">${escapeHtml(label)}</span></label>`;
    }).join('')}
      ${fornecedoresVisiveis.length ? '' : '<div class="multi-select-empty">Nenhum fornecedor encontrado para esta busca.</div>'}
      <div style="padding:8px 10px;border-top:1px solid #e2e8f0;display:flex;gap:6px;align-items:center">
        <input id="internalManualFornecedorInput" style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px" placeholder="Adicionar fornecedor manual..." />
        <button type="button" id="btnAddManualFornecedor" style="padding:6px 10px;border-radius:8px;border:1px solid #10b981;background:#ecfdf5;color:#065f46;cursor:pointer;font-size:13px;white-space:nowrap">+ Adicionar</button>
      </div>
    `;

    menu.querySelector('#btnAddManualFornecedor')?.addEventListener('click', () => {
      const inp = menu.querySelector('#internalManualFornecedorInput');
      const nome = String(inp?.value || '').trim();
      if (!nome) return;
      // Create a synthetic fornecedor entry
      const existente = state.pendingFornecedores.find((f) => String(f.fornecedor || f.nome || '').toLowerCase() === nome.toLowerCase());
      if (!existente) {
        const synth = normalizePendingFornecedor({ id: `manual-${Date.now()}`, fornecedor: nome, nome, notas: [], notasFiscais: [], quantidadeNotas: 0, quantidadeVolumes: 0, pesoTotalKg: 0, origemManual: true });
        state.pendingFornecedores.push(synth);
        const selectedFornecedores = getSelectedInternalFornecedores();
        selectedFornecedores.push(synth);
        applyPendingFornecedoresInterno(selectedFornecedores);
        renderInternalFornecedorDropdown();
        return;
      }
      // Already in list — just select
      const selected = getSelectedInternalFornecedores();
      if (!selected.find((f) => String(f.id) === String(existente.id))) {
        selected.push(existente);
        applyPendingFornecedoresInterno(selected);
        renderInternalFornecedorDropdown();
      }
    });

    menu.querySelector('#internalFornecedorSearchInput')?.addEventListener('input', (event) => {
      state.internalFornecedorSearchTerm = String(event.target.value || '');
      renderInternalFornecedorDropdown();
      menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
    });

    menu.querySelectorAll('input[type="checkbox"][data-fornecedor-id]').forEach((input) => {
      input.addEventListener('change', () => {
        const checkedIds = [...menu.querySelectorAll('input[type="checkbox"][data-fornecedor-id]:checked')].map((el) => String(el.dataset.fornecedorId || '').trim()).filter(Boolean);
        clearInternalPendingSelectionState({ keepFornecedor: true });
        const selectedFornecedores = checkedIds.map((id) => getPendingFornecedorById(id)).filter(Boolean);
        applyPendingFornecedoresInterno(selectedFornecedores);
        // FIX 5: Auto-fill transportadora
        autoFillTransportadoraForFornecedores(selectedFornecedores);
      });
    });

    const refreshedSearchInput = menu.querySelector('#internalFornecedorSearchInput');
    if (refreshedSearchInput && activeSearchInput) {
      refreshedSearchInput.focus();
      const start = activeSelectionStart == null ? refreshedSearchInput.value.length : Math.min(activeSelectionStart, refreshedSearchInput.value.length);
      const end = activeSelectionEnd == null ? start : Math.min(activeSelectionEnd, refreshedSearchInput.value.length);
      try { refreshedSearchInput.setSelectionRange(start, end); } catch {}
    }

    if (!wrapper.dataset.bound) {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        const isHidden = menu.classList.contains('hidden');
        closeInternalFornecedorDropdown();
        if (isHidden) {
          menu.classList.remove('hidden');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target)) closeInternalFornecedorDropdown();
      });
      wrapper.dataset.bound = 'true';
    }

    updateInternalFornecedorDropdownTrigger();
  }

  function syncInternalSelectionFromDom(wrap = byId('internalPendingNotas')) {
    if (!wrap) return;
    wrap.querySelectorAll('[data-internal-key]').forEach((el) => {
      const key = String(el.dataset.internalKey || '').trim();
      if (!key) return;
      if (el.checked) state.internalSelectedNotaKeys.add(key);
      else state.internalSelectedNotaKeys.delete(key);
    });
  }

  function selectedInternalNotas() {
    syncInternalSelectionFromDom();
    const unique = [];
    const seen = new Set();

    for (const nota of getCurrentInternalNotas()) {
      const normalized = normalizePendingNota(nota);
      const key = buildInternalNotaKey(normalized);
      if (!key || !state.internalSelectedNotaKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      unique.push({
        ...normalized,
        rowHash: key,
        fornecedor: normalized.fornecedor || normalized.fornecedorGrupo,
        disponivelNoRelatorio: normalized.disponivelNoRelatorio,
        origemManual: normalized.origemManual,
        inseridaManual: normalized.inseridaManual,
        preLancamentoPendente: normalized.preLancamentoPendente
      });
    }

    state.internalSelectedNotas = unique.map((nota) => ({ ...nota }));
    return unique;
  }

  function updateInternalTotals() {
    const notas = selectedInternalNotas();
    const totalVolumes = notas.reduce((acc, nota) => acc + Number(nota.volumes || 0), 0);
    const totalPeso = notas.reduce((acc, nota) => acc + Number(nota.peso || 0), 0);
    const totalValor = notas.reduce((acc, nota) => acc + Number(nota.valorNf || 0), 0);
    const setValue = (id, value) => { const el = byId(id); if (el) el.value = value; };
    setValue('internalQuantidadeNotas', formatIntegerBR(notas.length));
    setValue('internalQuantidadeVolumes', formatDecimalBR(totalVolumes, 3));
    setValue('internalPesoTotalKg', formatDecimalBR(totalPeso, 3));
    setValue('internalValorTotalNf', formatDecimalBR(totalValor, 2));
  }

  function syncPendingNotasSelectionUI(wrap) {
    const boxes = [...(wrap?.querySelectorAll('[data-internal-key]') || [])];
    const button = wrap?.querySelector('#btnSelectAllPendingNotas');
    if (!button) return;
    const allChecked = boxes.length > 0 && boxes.every((el) => el.checked);
    button.textContent = allChecked ? 'Desmarcar todos' : 'Selecionar todos';
    button.disabled = boxes.length === 0;
  }

  function refreshPendingFornecedorOptionText(item) {
    if (!item?.id) return;
    const label = `${String(item.fornecedor || item.nome || '-').trim()} (${formatIntegerBR(item.quantidadeNotas ?? 0)} NF)`;
    const publicSelect = byId('fornecedorPendenteSelect');
    if (publicSelect?.options?.length) {
      const option = [...publicSelect.options].find((entry) => String(entry.value || '') === String(item.id));
      if (option) option.textContent = label;
    }
    const optionLabel = [...document.querySelectorAll('#internalFornecedorDropdownMenu .multi-select-option')].find((entry) => String(entry.dataset.fornecedorId || '') === String(item.id))?.querySelector('.multi-select-option-text');
    if (optionLabel) optionLabel.textContent = label;
    updateInternalFornecedorDropdownTrigger();
  }

  function renderPendingNotasInterno() {
    syncInternalSelectionFromDom();
    const wrap = byId('internalPendingNotas');
    if (!wrap) return;
    const fornecedoresSelecionados = getSelectedInternalFornecedores();
    if (!fornecedoresSelecionados.length) {
      wrap.innerHTML = '<div class="warning-box">Selecione ao menos um fornecedor pendente para carregar as NF disponíveis.</div>';
      updateInternalTotals();
      return;
    }

    const searchTerm = String(state.internalPendingSearchTerm || '').trim().toLowerCase();
    const fornecedoresRender = fornecedoresSelecionados.map((fornecedor) => {
      const nomeFornecedor = String(fornecedor?.fornecedor || fornecedor?.nome || '-').trim() || '-';
      const sourceNotas = (Array.isArray(fornecedor?.notas) ? fornecedor.notas : Array.isArray(fornecedor?.notasFiscais) ? fornecedor.notasFiscais : [])
        .map((nota) => normalizePendingNota({ ...nota, fornecedor: String(nota?.fornecedor || nomeFornecedor).trim(), fornecedorGrupo: nomeFornecedor }));
      const notasOrdenadas = [...sourceNotas].sort((a, b) => {
        if (!!a.alertaVencimentoProximo !== !!b.alertaVencimentoProximo) return a.alertaVencimentoProximo ? -1 : 1;
        const dueA = a.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(a.diasParaPrimeiroVencimento);
        const dueB = b.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(b.diasParaPrimeiroVencimento);
        if (dueA !== dueB) return dueA - dueB;
        return String(a.numeroNf || '').localeCompare(String(b.numeroNf || ''), 'pt-BR');
      });
      const notas = searchTerm
        ? notasOrdenadas.filter((nota) => {
            const numero = String(nota.numeroNf || '').toLowerCase();
            const serie = String(nota.serie || '').toLowerCase();
            return numero.includes(searchTerm) || serie.includes(searchTerm);
          })
        : notasOrdenadas;
      return { fornecedor, nomeFornecedor, notas };
    }).filter((item) => item.notas.length);

    if (!fornecedoresRender.length) {
      wrap.innerHTML = `
        <div class="warning-box">
          Nenhuma NF localizada para a busca informada.
          <div class="pending-notas-empty-actions">
            ${fornecedoresSelecionados.length === 1 ? '<button type="button" id="btnInsertManualPendingNota">Inserir NF manualmente</button>' : '<span class="hint">Para inserir NF manualmente, mantenha apenas um fornecedor selecionado.</span>'}
          </div>
        </div>
      `;
      wrap.querySelector('#btnInsertManualPendingNota')?.addEventListener('click', () => openManualNotaModal(state.internalPendingSearchTerm));
      updateInternalTotals();
      return;
    }

    const htmlForFornecedor = fornecedoresRender.map(({ nomeFornecedor, notas }) => {
      const groups = [
        { title: 'Notas com 1º vencimento próximo', items: notas.filter((nota) => nota.alertaVencimentoProximo), highlight: true },
        { title: 'Demais notas pendentes', items: notas.filter((nota) => !nota.alertaVencimentoProximo), highlight: false }
      ].filter((group) => group.items.length);

      return `
        <div class="pending-fornecedor-group">
          <div class="pending-fornecedor-header">
            <h4>${escapeHtml(nomeFornecedor)}</h4>
            <span>${escapeHtml(formatIntegerBR(notas.length))} NF</span>
          </div>
          ${groups.map((group) => `<div class="pending-notas-group${group.highlight ? ' pending-notas-group-highlight' : ''}"><h4>${escapeHtml(group.title)} <span>${escapeHtml(formatIntegerBR(group.items.length))} NF</span></h4><div class="pending-notas-grid">${group.items.map((nota) => {
            const key = buildInternalNotaKey(nota);
            const dueClass = nota.alertaVencimentoProximo ? ' pending-nota-item-warning' : '';
            const manualClass = nota.origemManual || nota.inseridaManual || nota.preLancamentoPendente ? ' pending-nota-item-manual' : '';
            const tooltip = nota.tooltipVencimento || '';
            const label = `NF ${nota.numeroNf || '-'} • Série ${nota.serie || '-'}`;
            const dueBadge = nota.alertaVencimentoProximo ? `<span class="pending-note-due-badge" title="${escapeHtml(tooltip)}">Venc. próximo${nota.dataPrimeiroVencimentoBr ? ` • ${escapeHtml(nota.dataPrimeiroVencimentoBr)}` : ''}</span>` : '';
            const manualBadge = nota.origemManual || nota.inseridaManual || nota.preLancamentoPendente ? `<span class="pending-note-manual-badge" title="NF inserida manualmente e sem pré-lançamento no relatório terceirizado.">Inserida manualmente</span>` : '';
            const empresa = nota.empresa ? `<span class="pending-note-company">${escapeHtml(nota.empresa)}</span>` : '';
            const destinoLogo = renderStoreLogo(nota.destino || nota.empresa, { showEmpty: false });
            const dataEntrada = nota.dataEntradaBr || nota.dataEntrada || '-';
            const checked = state.internalSelectedNotaKeys.has(key) ? 'checked' : '';
            const volumeValor = Number(nota.volumes ?? 0);
            const volumeDisplay = Number.isFinite(volumeValor) ? formatDecimalBR(volumeValor, 3) : '0,000';
            return `<div class="pending-nota-item${dueClass}${manualClass}" title="${escapeHtml(tooltip)}"><label class="pending-nota-card"><div class="pending-nota-check"><input type="checkbox" data-internal-key="${escapeHtml(key)}" ${checked} /><span>${escapeHtml(label)}</span><div class="pending-note-tags">${empresa}${destinoLogo}${manualBadge}${dueBadge}</div></div><div class="pending-nota-meta"><span><strong>Entrada:</strong> ${escapeHtml(dataEntrada)}</span><span><strong>Peso:</strong> ${escapeHtml(formatDecimalBR(Number(nota.peso || 0), 3))} kg</span><span><strong>Volumes:</strong> <span class="nota-volume-val" data-nota-key="${escapeHtml(key)}">${escapeHtml(volumeDisplay)}</span> <button type="button" class="btn-edit-volume" data-nota-key="${escapeHtml(key)}" title="Editar volumes">✏️</button></span></div></label></div>`;
          }).join('')}</div></div>`).join('')}
        </div>
      `;
    }).join('');

    wrap.innerHTML = `<div class="pending-notas-toolbar"><button type="button" class="btn-secondary" id="btnSelectAllPendingNotas">Selecionar todos</button></div>${htmlForFornecedor}`;

    const sync = () => {
      syncInternalSelectionFromDom(wrap);
      updateInternalTotals();
      syncPendingNotasSelectionUI(wrap);
    };

    wrap.querySelectorAll('[data-internal-key]').forEach((el) => el.addEventListener('change', sync));

    // Wire up volume edit buttons
    wrap.querySelectorAll('.btn-edit-volume').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const notaKey = btn.dataset.notaKey;
        const nota = getCurrentInternalNotas().find((n) => buildInternalNotaKey(normalizePendingNota(n)) === notaKey);
        if (!nota) return;
        const currentVol = Number(nota.volumes ?? 0);

        // Clean modal instead of window.prompt
        const existing = byId('volumeEditModal'); if (existing) existing.remove();
        const modal = document.createElement('div');
        modal.id = 'volumeEditModal';
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:500;padding:16px';
        modal.innerHTML = `
          <div style="background:#fff;border-radius:20px;padding:28px 32px;width:100%;max-width:380px;box-shadow:0 24px 64px rgba(15,23,42,0.18);font-family:inherit">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
              <h3 style="margin:0;font-size:17px;color:#0f172a">Editar volumes</h3>
              <button id="volModalClose" style="background:none;border:none;font-size:22px;cursor:pointer;color:#94a3b8;line-height:1">✕</button>
            </div>
            <div style="background:#f8fafc;border-radius:12px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#475569">
              NF <strong style="color:#0f172a">${escapeHtml(String(nota.numeroNf||'-'))}</strong> · Série <strong style="color:#0f172a">${escapeHtml(String(nota.serie||'-'))}</strong>
            </div>
            <label style="display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#374151">Volumes</label>
            <input id="volModalInput" type="number" min="0" step="0.001"
              value="${currentVol}"
              style="width:100%;padding:12px 14px;border-radius:12px;border:2px solid #e2e8f0;font-size:16px;box-sizing:border-box;outline:none;transition:border .15s"
              onfocus="this.style.borderColor='#3b82f6'"
              onblur="this.style.borderColor='#e2e8f0'"
            />
            <p id="volModalErr" style="color:#ef4444;font-size:12px;margin:6px 0 0;min-height:18px"></p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
              <button id="volModalSave" style="padding:12px;border-radius:12px;border:none;background:#0f172a;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Salvar</button>
              <button id="volModalCancel" style="padding:12px;border-radius:12px;border:2px solid #e2e8f0;background:#fff;color:#0f172a;font-weight:600;font-size:14px;cursor:pointer">Cancelar</button>
            </div>
          </div>`;
        document.body.appendChild(modal);
        const inp = modal.querySelector('#volModalInput');
        setTimeout(() => { inp?.focus(); inp?.select(); }, 50);

        const closeModal = () => modal.remove();
        modal.querySelector('#volModalClose').onclick = closeModal;
        modal.querySelector('#volModalCancel').onclick = closeModal;
        modal.onclick = (ev) => { if (ev.target === modal) closeModal(); };

        modal.querySelector('#volModalSave').onclick = () => {
          const raw = String(inp.value).replace(',', '.');
          const parsed = parseFloat(raw);
          const errEl = modal.querySelector('#volModalErr');
          if (!Number.isFinite(parsed) || parsed < 0) { errEl.textContent = 'Informe um número válido.'; return; }
          nota.volumes = parsed;
          const fornecedores = getSelectedInternalFornecedores();
          for (const forn of fornecedores) {
            const src = Array.isArray(forn.notas) ? forn.notas : (Array.isArray(forn.notasFiscais) ? forn.notasFiscais : []);
            const idx = src.findIndex((n) => buildInternalNotaKey(normalizePendingNota(n)) === notaKey);
            if (idx > -1) { src[idx].volumes = parsed; forn.quantidadeVolumes = src.reduce((a, n) => a + Number(n.volumes || 0), 0); }
          }
          const span = wrap.querySelector(`.nota-volume-val[data-nota-key="${CSS.escape(notaKey)}"]`);
          if (span) span.textContent = formatDecimalBR(parsed, 3);
          updateInternalTotals();
          closeModal();
        };
        // Enter key saves
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') modal.querySelector('#volModalSave').click(); });
      });
    });

    wrap.querySelector('#btnSelectAllPendingNotas')?.addEventListener('click', () => {
      const checkboxes = [...wrap.querySelectorAll('[data-internal-key]')];
      const allChecked = checkboxes.length > 0 && checkboxes.every((el) => el.checked);
      checkboxes.forEach((el) => {
        el.checked = !allChecked;
        const key = String(el.dataset.internalKey || '').trim();
        if (!key) return;
        if (!allChecked) state.internalSelectedNotaKeys.add(key);
        else state.internalSelectedNotaKeys.delete(key);
      });
      updateInternalTotals();
      syncPendingNotasSelectionUI(wrap);
    });

    updateInternalTotals();
    syncPendingNotasSelectionUI(wrap);
  }

  function openManualNotaModal(seed = '') {
    if (!state.internalPendingFornecedor) {
      byId('agendamentoMsg').textContent = 'Selecione primeiro o fornecedor pendente.';
      return;
    }
    if (getSelectedInternalFornecedores().length !== 1) {
      byId('agendamentoMsg').textContent = 'Para inserir NF manualmente, selecione apenas um fornecedor.';
      return;
    }
    const modal = byId('manualNotaModal');
    const form = byId('manualNotaForm');
    const msg = byId('manualNotaMsg');
    if (!modal || !form) return;
    form.reset();
    if (msg) msg.textContent = '';
    const numeroField = form.querySelector('[name="numeroNf"]');
    if (numeroField) numeroField.value = String(seed || '').trim();
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    setTimeout(() => numeroField?.focus(), 0);
  }

  function closeManualNotaModal() {
    const modal = byId('manualNotaModal');
    const form = byId('manualNotaForm');
    const msg = byId('manualNotaMsg');
    if (msg) msg.textContent = '';
    form?.reset();
    modal?.classList.add('hidden');
    document.body.classList.remove('modal-open');
  }

  function appendManualNotaToPendingFornecedor(nota = {}) {
    const fornecedor = state.internalPendingFornecedor;
    if (!fornecedor) throw new Error('Selecione o fornecedor pendente antes de inserir a NF.');
    const numeroNf = String(nota.numeroNf || '').trim();
    const serie = String(nota.serie || '').trim();
    const notasAtuais = getCurrentInternalNotas();
    const duplicate = notasAtuais.some((item) => String(item.numeroNf || '').trim() === numeroNf && String(item.serie || '').trim() === serie);
    if (duplicate) throw new Error('Esta NF já está listada para o fornecedor selecionado.');

    const normalized = normalizePendingNota({
      ...nota,
      observacao: String(nota.observacao || 'NF inserida manualmente - sem pré-lançamento').trim(),
      origemManual: true,
      inseridaManual: true,
      preLancamentoPendente: true,
      disponivelNoRelatorio: false,
      tooltipVencimento: 'NF inserida manualmente; sem pré-lançamento no relatório terceirizado.'
    });

    const updatedNotas = [...notasAtuais, normalized];
    fornecedor.notas = updatedNotas;
    fornecedor.notasFiscais = updatedNotas;
    fornecedor.quantidadeNotas = updatedNotas.length;
    fornecedor.quantidadeVolumes = updatedNotas.reduce((acc, item) => acc + Number(item.volumes || 0), 0);
    fornecedor.pesoTotalKg = updatedNotas.reduce((acc, item) => acc + Number(item.peso || 0), 0);
    state.internalPendingFornecedor = fornecedor;
    state.internalSelectedNotaKeys.add(buildInternalNotaKey(normalized));
    state.internalPendingSearchTerm = '';
    state.internalFornecedorSearchTerm = '';
    const searchInput = byId('internalPendingSearch');
    if (searchInput) searchInput.value = '';
    refreshPendingFornecedorOptionText(fornecedor);
    renderPendingNotasInterno();
    return normalized;
  }

  async function notifyFiscalForManualNota(nota = {}) {
    const fornecedor = String(state.internalPendingFornecedor?.fornecedor || state.internalPendingFornecedor?.nome || byId('internalFornecedorNome')?.value || '').trim();
    return api('/api/agendamentos/notas/manual-alerta', {
      method: 'POST',
      body: JSON.stringify({
        fornecedor,
        numeroNf: nota.numeroNf,
        serie: nota.serie,
        volumes: nota.volumes,
        peso: nota.peso,
        destino: nota.destino,
        observacao: nota.observacao || ''
      })
    });
  }

  function applyFornecedorPendenteInterno(item) {
    clearInternalPendingSelectionState({ keepFornecedor: true });
    applyPendingFornecedoresInterno(item ? [item] : []);
  }

  function buildOccurrencePayload() {
    const form = byId('agendamentoForm');
    if (!form) throw new Error('Formulário de agendamento não localizado.');
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.notas = selectedInternalNotas();
    payload.fornecedor = String(payload.fornecedor || '').trim();
    payload.transportadora = String(payload.transportadora || '').trim();
    return payload;
  }

  async function registrarOcorrenciaInterna() {
    const payload = buildOccurrencePayload();
    if (!payload.fornecedor) throw new Error('Selecione o fornecedor pendente antes de registrar a ocorrência.');
    if (!payload.notas.length) throw new Error('Selecione ao menos uma NF para registrar a ocorrência.');
    const response = await api('/api/agendamentos/ocorrencia', { method: 'POST', body: JSON.stringify(payload) });
    byId('agendamentoMsg').textContent = response.message || 'Ocorrência registrada com sucesso.';
    clearInternalPendingSelectionState();
    renderInternalFornecedorDropdown();
    renderPendingNotasInterno();
    await Promise.allSettled([loadFornecedoresPendentesInterno(), loadFornecedoresPendentes(), loadDashboard(), loadDocas(), loadFilterOptions(), loadAuditoria()]);
  }

  // FIX 5&7: Auto-fill or show per-supplier transportadora fields
  async function autoFillTransportadoraForFornecedores(fornecedores = []) {
    const form = byId('agendamentoForm');
    if (!form || !fornecedores.length) return;
    const transpInput = form.querySelector('[name="transportadora"]');
    if (!transpInput) return;

    function applyTranspCadastro(transp) {

      if (!transp) return;
      if (transp.nome) transpInput.value = transp.nome;
      const emailTranspInput = form.querySelector('[name="emailTransportadora"]');
      const emailMotoInput = form.querySelector('[name="emailMotorista"]');
      const telefoneMotoInput = form.querySelector('[name="telefoneMotorista"]');
      if (emailTranspInput && transp.email && !emailTranspInput.value) emailTranspInput.value = transp.email;
      if (emailMotoInput && transp.email && !emailMotoInput.value) emailMotoInput.value = transp.email;
      if (telefoneMotoInput && transp.telefone && !telefoneMotoInput.value) telefoneMotoInput.value = transp.telefone;
    }


    async function fetchTranspByFornecedor(nomeFornecedor) {
      try {
        const data = await api(`/api/cadastros/transportadoras/por-fornecedor?nome=${encodeURIComponent(nomeFornecedor)}`);
        return Array.isArray(data) ? data[0] : (data || null);
      } catch { return null; }
    }
    if (fornecedores.length === 1) {
      const forn = fornecedores[0];
      const transpNome = String(forn?.transportadora || '').trim();
      const perTable = byId('perSupplierTranspContainer');
      if (perTable) perTable.style.display = 'none';

      // Try cadastro first
      const nomeForn = String(forn?.fornecedor || forn?.nome || '').trim();
      const cadastro = nomeForn ? await fetchTranspByFornecedor(nomeForn) : null;
      if (cadastro) {
        applyTranspCadastro(cadastro);
      } else if (transpNome) {
        transpInput.value = transpNome;
      }
      return;
    }

    // Multi-supplier: resolve each one from cadastro, then check if all share same transportadora
    const resolved = await Promise.all(fornecedores.map(async (forn) => {
      const nomeForn = String(forn?.fornecedor || forn?.nome || '').trim();
      const cadastro = nomeForn ? await fetchTranspByFornecedor(nomeForn) : null;
      return { forn, cadastro, transpNome: cadastro?.nome || String(forn?.transportadora || '').trim() };
    }));

    const uniqueTransps = [...new Set(resolved.map((r) => r.transpNome).filter(Boolean))];
    if (uniqueTransps.length === 1) {
      const winner = resolved.find((r) => r.cadastro);
      if (winner?.cadastro) {
        applyTranspCadastro(winner.cadastro);
      } else {
        transpInput.value = uniqueTransps[0];
      }
      const perTable = byId('perSupplierTranspContainer');
      if (perTable) perTable.style.display = 'none';
      return;
    }

    // Different transportadoras: annotate fornecedor objects and show per-supplier inputs
    resolved.forEach(({ forn, transpNome }) => { if (transpNome) forn.transportadora = transpNome; });
    renderPerSupplierTranspFields(fornecedores);
  }

  function renderPerSupplierTranspFields(fornecedores = []) {
    let container = byId('perSupplierTranspContainer');
    if (!container) {
      const form = byId('agendamentoForm');
      const transpLabel = form?.querySelector('[name="transportadora"]')?.closest('label');
      if (!transpLabel) return;
      container = document.createElement('div');
      container.id = 'perSupplierTranspContainer';
      container.style.cssText = 'grid-column:1/-1;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:12px;margin-top:4px;display:grid;gap:8px';
      transpLabel.parentNode.insertBefore(container, transpLabel.nextSibling);
    }
    container.style.display = 'grid';
    container.innerHTML = `<strong style="font-size:13px;color:#92400e">Transportadora por fornecedor</strong><p style="margin:0;font-size:12px;color:#78716c">Transportadoras diferentes por fornecedor — preencha individualmente. O campo global será preenchido automaticamente se forem iguais.</p>` +
      fornecedores.map((forn) => {
        const nome = String(forn.fornecedor || forn.nome || '').trim();
        const transp = String(forn.transportadora || '').trim();
        return `<div style="display:flex;gap:8px;align-items:center"><span style="min-width:140px;font-size:12px;font-weight:600;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(nome)}">${escapeHtml(nome)}</span><input data-per-supplier-transp="${escapeHtml(nome)}" style="flex:1;padding:7px 10px;border-radius:8px;border:1px solid #cbd5e1;font-size:13px" placeholder="Transportadora" value="${escapeHtml(transp)}" /></div>`;
      }).join('');

    // Wire inputs: if all equal, fill global input
    container.querySelectorAll('[data-per-supplier-transp]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const all = [...container.querySelectorAll('[data-per-supplier-transp]')].map((el) => el.value.trim()).filter(Boolean);
        const unique = [...new Set(all)];
        const globalInput = byId('agendamentoForm')?.querySelector('[name="transportadora"]');
        if (unique.length === 1 && globalInput) globalInput.value = unique[0];
        // Store per-supplier values back into state
        container.querySelectorAll('[data-per-supplier-transp]').forEach((el) => {
          const fornNome = el.dataset.perSupplierTransp;
          const forn = getSelectedInternalFornecedores().find((f) => String(f.fornecedor || f.nome || '').trim() === fornNome);
          if (forn) forn.transportadora = el.value.trim();
        });
      });
    });
  }

  function openKpiModal(titulo, items = []) {
    const existing = byId('kpiStatusModal');
    if (existing) existing.remove();
    const cols = ['protocolo','status','dataAgendada','horaAgendada','fornecedor','transportadora'];
    const colLabels = { protocolo:'Protocolo', status:'Status', dataAgendada:'Data', horaAgendada:'Hora', fornecedor:'Fornecedor', transportadora:'Transportadora' };
    const rows = items.map((ag) => `<tr>${cols.map((c) => `<td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:13px;white-space:nowrap">${escapeHtml(String(ag[c] || '-'))}</td>`).join('')}</tr>`).join('');
    const modal = document.createElement('div');
    modal.id = 'kpiStatusModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px';
    modal.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:860px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="margin:0">${escapeHtml(titulo)} <span style="font-size:14px;font-weight:400;color:#64748b">(${items.length})</span></h3><button id="kpiModalClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button></div>${items.length===0?'<p style="color:#64748b">Nenhum agendamento neste status.</p>':`<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr>${cols.map((c)=>`<th style="text-align:left;padding:8px 10px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">${escapeHtml(colLabels[c]||c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`}</div>`;
    document.body.appendChild(modal);
    modal.querySelector('#kpiModalClose').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  }

  async function loadFornecedoresPendentesInterno() {
    try {
      const items = await api('/api/public/fornecedores-pendentes');
      state.pendingFornecedores = sortPendingFornecedores(Array.isArray(items) ? items.map(normalizePendingFornecedor) : []);
      const stillSelected = getSelectedInternalFornecedores().map((item) => String(item?.id || '')).filter(Boolean);
      const preserved = stillSelected.map((id) => getPendingFornecedorById(id)).filter(Boolean);
      state.internalPendingFornecedores = preserved;
      state.internalPendingFornecedor = preserved.length === 1 ? preserved[0] : (preserved[0] || null);
      renderInternalFornecedorDropdown();
      renderPendingNotasInterno();
    } catch {}
  }

  async function loadDocaOptions() {
    if (!state.token || isTokenExpired(state.token)) return;
    try {
      const items = await api('/api/cadastros/docas');
      state.docaOptions = Array.isArray(items) ? items : [];
    } catch {
      state.docaOptions = [];
    }
  }

  async function loadFilterOptions() {
    if (!state.token || isTokenExpired(state.token) || !hasPermission('dashboard.view')) return;
    try {
      const items = await api('/api/agendamentos');
      populateSelectOptions(byId('fStatus'), items.map((item) => item.status), 'Status');
      populateSelectOptions(byId('fFornecedor'), items.map((item) => item.fornecedor), 'Fornecedor');
      populateSelectOptions(byId('fTransportadora'), items.map((item) => item.transportadora), 'Transportadora');
      populateSelectOptions(byId('fMotorista'), items.map((item) => item.motorista), 'Motorista');
      populateSelectOptions(byId('fPlaca'), items.map((item) => item.placa), 'Placa');
    } catch {}
  }

  function updateConfirmacoesToolbar() {
    const toolbar = byId('confirmacoesSelecionadasToolbar');
    const countEl = byId('confirmacoesSelecionadasCount');
    const n = state.confirmacoesSelecionados.size;
    if (toolbar) toolbar.classList.toggle('hidden', n === 0);
    if (countEl) countEl.textContent = `${n} agendamento${n !== 1 ? 's' : ''} selecionado${n !== 1 ? 's' : ''}`;
  }

  function renderOperationalTable(items, { targetId, includeActions = false, includeSelect = false } = {}) {
    const wrap = byId(targetId);
    const allowDockActions = includeActions && hasPermission('agendamentos.definir_doca');
    if (!wrap) return;
    if (!Array.isArray(items) || !items.length) {
      wrap.innerHTML = '<p>Nenhum registro.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="table operational-table">
        <thead>
          <tr>
            ${includeSelect ? '<th style="width:36px"><input type="checkbox" id="chkSelectAll" title="Selecionar todos" /></th>' : ''}
            <th>ID</th>
            <th>Protocolo</th>
            <th>Status</th>
            <th>Fornecedor</th>
            <th>Transportadora</th>
            <th>Motorista</th>
            <th>Placa</th>
            <th>Data</th>
            <th>Hora</th>
            <th>FINITURA</th>
            <th>OBJ</th>
            <th>AC COELHO</th>
            <th>SR ACABAMENTOS</th>
            <th>Volumes</th>
            <th>Peso kg</th>
            ${allowDockActions ? '<th>Ações</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              ${includeSelect ? `<td><input type="checkbox" class="row-check" data-ag-id="${escapeHtml(String(item.id))}" /></td>` : ''}
              <td>${escapeHtml(item.id ?? '')}</td>
              <td>${escapeHtml(item.protocolo || '')}</td>
              <td>${renderStatusBadge(item.status, item.semaforo)}</td>
              <td>${escapeHtml(item.fornecedor || '')}</td>
              <td>${escapeHtml(item.transportadora || '')}</td>
              <td>${escapeHtml(item.motorista || '')}</td>
              <td>${escapeHtml(item.placa || '')}</td>
              <td>${escapeHtml(formatDateBR(item.dataAgendada || '') || '')}</td>
              <td>${escapeHtml(formatHour(item.horaAgendada || '') || '')}</td>
              <td class="empresa-notas-cell">${renderEmpresaNotas(item, 'FINITURA')}</td>
              <td class="empresa-notas-cell">${renderEmpresaNotas(item, 'OBJ')}</td>
              <td class="empresa-notas-cell">${renderEmpresaNotas(item, 'AC COELHO')}</td>
              <td class="empresa-notas-cell">${renderEmpresaNotas(item, 'SR ACABAMENTOS')}</td>
              <td>${escapeHtml(formatDecimalBR(item.quantidadeVolumes || 0, 3))}</td>
              <td>${escapeHtml(formatDecimalBR(item.pesoTotalKg || 0, 3))}</td>
              ${allowDockActions ? `<td>
                <div class="row gap8 wrap action-cell">
                  <button type="button" class="btn-secondary" data-select-agendamento="${escapeHtml(item.id)}">Usar ID</button>
                  <select data-doca-select="${escapeHtml(item.id)}" class="dock-select">${docaSelectOptions(item.doca?.id || item.docaId || item.doca || '')}</select>
                  <button type="button" data-definir-doca="${escapeHtml(item.id)}">Definir doca</button>
                </div>
              </td>` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    if (includeSelect) {
      const chkAll = wrap.querySelector('#chkSelectAll');
      const rowChecks = () => wrap.querySelectorAll('.row-check');

      if (chkAll) {
        chkAll.addEventListener('change', () => {
          rowChecks().forEach((chk) => {
            chk.checked = chkAll.checked;
            const id = chk.dataset.agId;
            if (id) {
              if (chkAll.checked) state.confirmacoesSelecionados.add(id);
              else state.confirmacoesSelecionados.delete(id);
            }
          });
          updateConfirmacoesToolbar();
        });
      }

      rowChecks().forEach((chk) => {
        chk.addEventListener('change', () => {
          const id = chk.dataset.agId;
          if (id) {
            if (chk.checked) state.confirmacoesSelecionados.add(id);
            else state.confirmacoesSelecionados.delete(id);
          }
          if (chkAll) {
            const all = rowChecks();
            chkAll.indeterminate = state.confirmacoesSelecionados.size > 0 && state.confirmacoesSelecionados.size < all.length;
            chkAll.checked = state.confirmacoesSelecionados.size === all.length && all.length > 0;
          }
          updateConfirmacoesToolbar();
        });
      });
    }

    if (allowDockActions) {
      wrap.querySelectorAll('[data-select-agendamento]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const field = byId('agendamentoId');
          if (field) field.value = btn.dataset.selectAgendamento || '';
        });
      });
      wrap.querySelectorAll('[data-definir-doca]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const agendamentoId = btn.dataset.definirDoca;
          const select = wrap.querySelector(`[data-doca-select="${agendamentoId}"]`);
          const docaId = select?.value || '';
          if (!docaId) {
            byId('operacaoMsg').textContent = 'Selecione a doca antes de confirmar.';
            return;
          }
          try {
            await api(`/api/agendamentos/${agendamentoId}/definir-doca`, { method: 'POST', body: JSON.stringify({ docaId }) });
            byId('operacaoMsg').textContent = 'Doca definida com sucesso.';
            const field = byId('agendamentoId');
            if (field) field.value = agendamentoId;
            await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas(), loadFilterOptions()]);
          } catch (err) {
            byId('operacaoMsg').textContent = err.message;
          }
        });
      });
    }
  }


  function renderPublicDates() {
    const dataSelect = byId("publicDataSelect");
    if (!dataSelect) return;

    const datas = state.disponibilidadePublica.filter((item) => item.disponivel);
    if (!datas.length) {
      dataSelect.innerHTML = "<option value=''>Sem datas disponíveis</option>";
      renderPublicSlots("");
      return;
    }

    dataSelect.innerHTML = datas.map((item) => `<option value="${item.data}">${formatDateBR(item.data)}</option>`).join("");
    renderPublicSlots(dataSelect.value);
  }

  async function loadPublicDisponibilidade() {
    const payload = await api("/api/public/disponibilidade?dias=21");
    state.disponibilidadePublica = Array.isArray(payload.agenda) ? payload.agenda : [];
    renderPublicDates();
  }

  function currentFilters() {
    return {
      status: byId("fStatus")?.value || "",
      fornecedor: byId("fFornecedor")?.value || "",
      transportadora: byId("fTransportadora")?.value || "",
      motorista: byId("fMotorista")?.value || "",
      placa: byId("fPlaca")?.value || "",
      dataAgendada: byId("fData")?.value || ""
    };
  }

  async function fillSelects() {
    if (!state.token || isTokenExpired(state.token)) return;
    if (!hasPermission('cadastros.view') && !hasPermission('agendamentos.create')) return;
    try {
      const janelas = await api("/api/cadastros/janelas");
      const janelaOptions = janelas.map((j) => `<option value="${j.id}">${escapeHtml(j.codigo)}</option>`).join("");
      const janelaSelect = byId("internalJanelaSelect");
      if (janelaSelect) {
        janelaSelect.innerHTML = janelaOptions;
        janelaSelect.removeEventListener('change', syncInternalHoraFromJanela);
        janelaSelect.addEventListener('change', syncInternalHoraFromJanela);
        syncInternalHoraFromJanela();
      }
      await Promise.allSettled([loadDocaOptions(), loadFilterOptions()]);
    } catch {}
  }

  // ── Calendar state ──────────────────────────────────────────────────────
  const calState = { year: new Date().getFullYear(), month: new Date().getMonth(), allAgendamentos: [] };

  function renderCalendar() {
    const { year, month, allAgendamentos } = calState;
    const label = byId('calMonthLabel');
    if (label) label.textContent = new Date(year, month, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
    const grid = byId('calendarGrid');
    if (!grid) return;
    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
    const agByDay = {};
    for (const ag of allAgendamentos) {
      const d = String(ag.dataAgendada || '').slice(0, 10);
      if (!d) continue;
      const [y, m, dd] = d.split('-').map(Number);
      if (y === year && m - 1 === month) { if (!agByDay[dd]) agByDay[dd] = []; agByDay[dd].push(ag); }
    }
    const STATUS_ORDER = ['PENDENTE_APROVACAO','SOLICITADO','APROVADO','CHEGOU','EM_DESCARGA','FINALIZADO','CANCELADO','NO_SHOW','REAGENDADO'];
    let html = dayNames.map((d) => `<div style="text-align:center;font-size:11px;font-weight:700;color:#64748b;padding:4px 0">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) html += '<div></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const cellDate = new Date(year, month, day); cellDate.setHours(0,0,0,0);
      const isPast = cellDate < today;
      const isToday = cellDate.getTime() === today.getTime();
      const ags = agByDay[day] || [];
      let statusDots = '';
      if (ags.length) {
        const counts = {};
        for (const ag of ags) {
          const s = String(ag.status || '').toUpperCase() || 'PENDENTE_APROVACAO';
          counts[s] = (counts[s] || 0) + 1;
        }
        statusDots = `<div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center;margin-top:3px">${
          STATUS_ORDER.filter((s) => counts[s]).map((s) => {
            const color = STATUS_COLORS[s] || '#94a3b8';
            const lbl = STATUS_LABELS[s] || s;
            return `<span title="${escapeHtml(lbl)}: ${counts[s]}" style="display:inline-flex;align-items:center;gap:2px;background:${color}20;color:${color};border-radius:99px;padding:1px 5px;font-size:9px;font-weight:700;line-height:1.4">${counts[s]}</span>`;
          }).join('')
        }</div>`;
      }
      html += `<div data-cal-day="${day}" style="min-height:52px;padding:5px 4px;border-radius:10px;border:1px solid ${isToday?'#3b82f6':'#e2e8f0'};background:${isPast?'#f8fafc':'#fff'};cursor:${ags.length?'pointer':'default'};opacity:${isPast&&!isToday?0.55:1};text-align:center">
        <span style="font-size:13px;font-weight:${isToday?700:400};color:${isToday?'#1d4ed8':'#0f172a'}">${day}</span>
        ${statusDots}
      </div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-cal-day]').forEach((cell) => {
      const day = Number(cell.dataset.calDay);
      const ags = agByDay[day] || [];
      if (!ags.length) return;
      cell.addEventListener('click', () => openDayModal(year, month, day, ags));
    });
  }

  function openDayModal(year, month, day, ags = []) {
    const dateLabel = new Date(year, month, day).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
    const totalNf = ags.reduce((a, ag) => a + Number(ag.quantidadeNotas || 0), 0);
    const totalVol = ags.reduce((a, ag) => a + Number(ag.quantidadeVolumes || 0), 0);
    const totalPeso = ags.reduce((a, ag) => a + Number(ag.pesoTotalKg || ag.quantidadePeso || 0), 0);
    const statusCounts = {};
    for (const ag of ags) {
      const s = String(ag.status || '').toUpperCase() || 'PENDENTE_APROVACAO';
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    const statusSummary = Object.entries(statusCounts).map(([s, n]) => {
      const color = STATUS_COLORS[s] || '#94a3b8';
      const lbl = STATUS_LABELS[s] || s;
      return `<span style="display:inline-flex;align-items:center;gap:4px;background:${color}18;color:${color};border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700">${escapeHtml(lbl)}: ${n}</span>`;
    }).join('');
    const rows = ags.map((ag) => `<tr>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(ag.protocolo||'-')}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(ag.horaAgendada||'-')}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(ag.fornecedor||'-')}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(ag.transportadora||'-')}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:12px"><span style="padding:2px 8px;border-radius:99px;font-size:11px;background:${statusColor2(ag.status)}20;color:${statusColor2(ag.status)}">${escapeHtml(STATUS_LABELS[String(ag.status||'').toUpperCase()] || ag.status || '-')}</span></td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(formatIntegerBR(ag.quantidadeNotas||0))}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(formatDecimalBR(ag.quantidadeVolumes||0,3))}</td>
      <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(formatDecimalBR(ag.pesoTotalKg||ag.quantidadePeso||0,3))}</td>
    </tr>`).join('');
    const existing = byId('dayModal'); if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'dayModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:200;padding:16px';
    modal.innerHTML = `<div style="background:#fff;border-radius:18px;padding:24px;max-width:900px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;text-transform:capitalize">${escapeHtml(dateLabel)}</h3>
        <button id="dayModalClose" style="background:none;border:none;font-size:20px;cursor:pointer">✕</button>
      </div>
      ${statusSummary ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px">${statusSummary}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
        ${[['Agendamentos',ags.length],['Notas',totalNf],['Volumes',formatDecimalBR(totalVol,3)],['Peso (kg)',formatDecimalBR(totalPeso,3)]].map(([l,v])=>`<div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center"><div style="font-size:11px;color:#64748b;text-transform:uppercase">${l}</div><div style="font-size:22px;font-weight:700;color:#0f172a">${v}</div></div>`).join('')}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${['Protocolo','Hora','Fornecedor','Transportadora','Status','NFs','Volumes','Peso'].map((h)=>`<th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">${h}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#dayModalClose').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  }

  function statusColor2(s=''){const m={PENDENTE_APROVACAO:'#f59e0b',APROVADO:'#10b981',CANCELADO:'#ef4444',NO_SHOW:'#8b5cf6',REAGENDADO:'#3b82f6',FINALIZADO:'#64748b',CHEGOU:'#06b6d4',EM_DESCARGA:'#f97316'};return m[s]||'#94a3b8';}

  let _chartInstances = {};
  function destroyChart(id) {
    // Destroy tracked instance
    if (_chartInstances[id]) {
      try { _chartInstances[id].destroy(); } catch(e) {}
      delete _chartInstances[id];
    }
    // Destroy any orphan on the canvas
    const canvas = document.getElementById(id);
    if (canvas) {
      try {
        const ex = typeof Chart !== 'undefined' && Chart.getChart ? Chart.getChart(canvas) : null;
        if (ex) ex.destroy();
      } catch(e) {}
      // Nuclear: replace canvas element to fully clear WebGL/2D context
      const parent = canvas.parentNode;
      if (parent) {
        const fresh = document.createElement('canvas');
        fresh.id = canvas.id;
        fresh.height = canvas.height || 200;
        fresh.style.cssText = canvas.style.cssText;
        parent.replaceChild(fresh, canvas);
      }
    }
  }

  function renderCharts(metricas = {}) {
    if (typeof Chart === 'undefined') return;
    const { pesoPorDia = [], rankingOcorrencias = [], rankingMelhores = [], mediaRecebimentoMin } = metricas;

    const CHART_OPTS = {
      responsive: true,
      maintainAspectRatio: true,
      animation: false,
      plugins: {
        tooltip: { enabled: false },
        legend: { display: false }
      }
    };

    function makeBarConfig(labels, data, color, opts = {}) {
      return {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: color + '22',
            borderColor: color,
            borderWidth: 2,
            borderRadius: 6,
            datalabels: { display: false }
          }]
        },
        options: {
          ...CHART_OPTS,
          ...opts,
          plugins: {
            ...CHART_OPTS.plugins,
            ...(opts.plugins || {})
          },
          scales: {
            x: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b', maxRotation: 30 } },
            y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
            ...(opts.scales || {})
          }
        }
      };
    }

    // Chart 1: Peso por dia
    destroyChart('chartPeso');
    const cPeso = byId('chartPeso');
    if (cPeso && pesoPorDia.length) {
      _chartInstances['chartPeso'] = new Chart(cPeso, makeBarConfig(
        pesoPorDia.map((d) => d.data.slice(5)),
        pesoPorDia.map((d) => Math.round(d.peso)),
        '#3b82f6'
      ));
    } else if (cPeso) {
      cPeso.parentNode.querySelector('.chart-empty')?.remove();
      const p = document.createElement('p'); p.className='chart-empty'; p.textContent='Sem dados de peso.'; cPeso.after(p);
    }

    // Chart 2: Ocorrências (stacked) — sem tooltip, com rótulos diretos
    destroyChart('chartOcorrencias');
    const cOc = byId('chartOcorrencias');
    if (cOc && rankingOcorrencias.length) {
      const top = rankingOcorrencias.slice(0, 7);
      _chartInstances['chartOcorrencias'] = new Chart(cOc, {
        type: 'bar',
        data: {
          labels: top.map((t) => t.nome.length > 12 ? t.nome.slice(0,12)+'…' : t.nome),
          datasets: [
            { label: 'Cancel.', data: top.map((t) => t.cancelamentos), backgroundColor: '#ef4444cc', borderRadius: 3, stack: 's' },
            { label: 'No-show', data: top.map((t) => t.noShow), backgroundColor: '#8b5cf6cc', borderRadius: 3, stack: 's' },
            { label: 'Atrasos', data: top.map((t) => t.atrasos), backgroundColor: '#f59e0bcc', borderRadius: 3, stack: 's' }
          ]
        },
        options: {
          ...CHART_OPTS,
          plugins: { tooltip: { enabled: false }, legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, boxWidth: 10 } } },
          scales: {
            x: { stacked: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 }, color: '#64748b', maxRotation: 30 } },
            y: { stacked: true, beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b', precision: 0 } }
          }
        }
      });
    }

    // Chart 3: Tempo médio descarga (horizontal bars)
    destroyChart('chartDescarga');
    const cDesc = byId('chartDescarga');
    const descData = rankingOcorrencias.filter((t) => t.mediaDescargaMin != null).slice(0, 6);
    if (cDesc && descData.length) {
      _chartInstances['chartDescarga'] = new Chart(cDesc, {
        type: 'bar',
        data: {
          labels: descData.map((t) => t.nome.length > 14 ? t.nome.slice(0,14)+'…' : t.nome),
          datasets: [{ data: descData.map((t) => t.mediaDescargaMin), backgroundColor: '#10b981cc', borderRadius: 5 }]
        },
        options: {
          ...CHART_OPTS,
          indexAxis: 'y',
          scales: {
            x: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
            y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#374151' } }
          }
        }
      });
    } else if (cDesc) {
      cDesc.parentNode.querySelector('.chart-empty')?.remove();
      const p = document.createElement('p'); p.className='chart-empty'; p.textContent='Sem dados de descarga.'; cDesc.after(p);
    }

    // Chart 4: Tempo agendamento → chegada
    destroyChart('chartAgendaChegada');
    const cAC = byId('chartAgendaChegada');
    const acData = rankingOcorrencias.filter((t) => t.mediaAgendaChegadaMin != null).slice(0, 6);
    if (cAC && acData.length) {
      _chartInstances['chartAgendaChegada'] = new Chart(cAC, {
        type: 'bar',
        data: {
          labels: acData.map((t) => t.nome.length > 14 ? t.nome.slice(0,14)+'…' : t.nome),
          datasets: [{ data: acData.map((t) => Math.round(t.mediaAgendaChegadaMin / 60 * 10) / 10), backgroundColor: '#6366f1cc', borderRadius: 5 }]
        },
        options: {
          ...CHART_OPTS,
          indexAxis: 'y',
          scales: {
            x: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { font: { size: 11 }, color: '#64748b' } },
            y: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#374151' } }
          }
        }
      });
    }

    // Rankings HTML
    const mkRanking = (id, items, fields) => {
      const el = byId(id); if (!el) return;
      if (!items.length) { el.innerHTML = '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px">Sem dados suficientes.</p>'; return; }
      el.innerHTML = `<div style="display:grid;gap:6px">${items.slice(0,8).map((t, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="font-size:12px;color:#94a3b8;font-weight:700">${i+1}</span>`;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;background:${i%2===0?'#f8fafc':'#fff'};border:1px solid #f1f5f9">
          <span style="min-width:22px;text-align:center">${medal}</span>
          <span style="flex:1;font-size:13px;font-weight:600;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.nome)}</span>
          ${fields.map((f) => `<span style="font-size:12px;color:#64748b;white-space:nowrap"><strong style="color:#374151">${escapeHtml(String(t[f.key]??0))}</strong> <small>${f.label}</small></span>`).join('')}
        </div>`;
      }).join('')}</div>`;
    };
    mkRanking('rankingMelhores', rankingMelhores, [{ key: 'finalizados', label: 'ok' }, { key: 'ocorrencias', label: 'ocorr.' }]);
    mkRanking('rankingOcorrencias', rankingOcorrencias, [{ key: 'cancelamentos', label: 'cancel.' }, { key: 'noShow', label: 'no-show' }, { key: 'atrasos', label: 'atrasos' }]);
  }

  async function loadDashboard() {
    if (!hasPermission('dashboard.view')) return;
    const [data, metricas] = await Promise.all([
      api('/api/dashboard/operacional'),
      api('/api/dashboard/metricas').catch(() => ({}))
    ]);
    const kpis = byId('kpis');
    const hiddenKpis = new Set(['documentos', 'volumes', 'origem', 'valorTotal']);
    const labels = { total:'Total', pendentes:'Pendentes', aprovados:'Aprovados', chegou:'Chegou', emDescarga:'Em descarga', finalizados:'Finalizados', cancelados:'Cancelados', noShow:'No-show', pesoKg:'Peso (kg)' };
    const allAgendamentos = data.agendamentos || [];
    const kpiModalStatuses = new Set(['CANCELADO','NO_SHOW','REAGENDADO','FINALIZADO']);
    const extraKpiKeys = { cancelados: 'CANCELADO', noShow: 'NO_SHOW', reagendados: 'REAGENDADO', finalizados: 'FINALIZADO' };
    const kpiData = { ...data.kpis };
    for (const [kpiKey, status] of Object.entries(extraKpiKeys)) {
      kpiData[kpiKey] = allAgendamentos.filter((ag) => String(ag.status || '').toUpperCase() === status).length;
    }
    if (kpis) {
      kpis.className = 'kpi-grid';
      kpis.innerHTML = '';
      const kpiModalMap = { finalizados: 'FINALIZADO', cancelados: 'CANCELADO', noShow: 'NO_SHOW', reagendados: 'REAGENDADO' };
      Object.entries(kpiData || {}).forEach(([k, v]) => {
        if (hiddenKpis.has(String(k || ''))) return;
        const div = document.createElement('div');
        const modalStatus = kpiModalMap[k];
        div.className = 'kpi' + (modalStatus ? ' kpi-clickable' : '');
        if (modalStatus) div.title = `Clique para ver ${labels[k] || k}`;
        const key = String(k || '');
        let formatted = v;
        if (key.includes('valor')) formatted = Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        else if (key.toLowerCase().includes('peso')) formatted = formatDecimalBR(v || 0, 3);
        else if (typeof v === 'number') formatted = formatIntegerBR(v);
        const length = String(formatted ?? '').length;
        const valueClass = length > 16 ? 'kpi-value kpi-value-compact' : length > 11 ? 'kpi-value kpi-value-tight' : 'kpi-value';
        const label = labels[k] || statusLabel(k);
        div.innerHTML = `<span class="kpi-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="${valueClass}" title="${escapeHtml(formatted)}">${escapeHtml(formatted)}</span>`;
        if (modalStatus) {
          div.addEventListener('click', () => {
            const items = allAgendamentos.filter((ag) => String(ag.status || '').toUpperCase() === modalStatus);
            openKpiModal(labels[k] || k, items);
          });
        }
        kpis.appendChild(div);
      });
    }
    // Update calendar
    calState.allAgendamentos = allAgendamentos;
    renderCalendar();
    // Charts
    renderCharts(metricas);
    // Wire calendar nav every time dashboard loads (re-clone to avoid duplicate listeners)
    const prevBtn = byId('calPrev'); const nextBtn = byId('calNext');
    if (prevBtn) {
      const pClone = prevBtn.cloneNode(true); prevBtn.parentNode.replaceChild(pClone, prevBtn);
      pClone.addEventListener('click', () => { calState.month--; if (calState.month < 0) { calState.month = 11; calState.year--; } renderCalendar(); });
    }
    if (nextBtn) {
      const nClone = nextBtn.cloneNode(true); nextBtn.parentNode.replaceChild(nClone, nextBtn);
      nClone.addEventListener('click', () => { calState.month++; if (calState.month > 11) { calState.month = 0; calState.year++; } renderCalendar(); });
    }
    // Render pending table — include SOLICITADO and empty-string status (MySQL non-strict ENUM stores '' for unknown values)
    const activeStatuses = new Set(['SOLICITADO', 'PENDENTE_APROVACAO', 'APROVADO', '']);
    const pending = allAgendamentos.filter((ag) => activeStatuses.has(String(ag.status||'').toUpperCase()));
    renderPendingTable(pending);

    // Wire search
    const searchInput = byId('pendingSearch');
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = '1';
      searchInput.addEventListener('input', () => {
        const term = searchInput.value.trim().toLowerCase();
        const filtered = term ? pending.filter((ag) => JSON.stringify(ag).toLowerCase().includes(term)) : pending;
        renderPendingTable(filtered);
      });
    }

    await maybeShowMissingRelatorioAlerts(data.agendamentos || []);
  }

  const STATUS_COLORS = { SOLICITADO:'#f59e0b', PENDENTE_APROVACAO:'#f59e0b', APROVADO:'#10b981', CANCELADO:'#ef4444', NO_SHOW:'#8b5cf6', REAGENDADO:'#3b82f6', FINALIZADO:'#64748b', CHEGOU:'#06b6d4', EM_DESCARGA:'#f97316' };
  const STATUS_LABELS = { SOLICITADO:'Pendente', PENDENTE_APROVACAO:'Pendente', APROVADO:'Aprovado', CANCELADO:'Cancelado', NO_SHOW:'No-show', REAGENDADO:'Reagendado', FINALIZADO:'Finalizado', CHEGOU:'Chegou', EM_DESCARGA:'Em descarga' };

  function renderPendingTable(items = []) {
    const tbody = byId('dashboardTableBody');
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">Nenhum agendamento pendente.</td></tr>';
      return;
    }
    tbody.innerHTML = items.map((ag, i) => {
      const statusKey = String(ag.status || '').toUpperCase() || 'SOLICITADO';
      const color = STATUS_COLORS[statusKey] || '#94a3b8';
      const label = STATUS_LABELS[statusKey] || ag.status || 'Pendente';
      const bg = i % 2 === 0 ? '#fff' : '#fafafa';
      return `<tr style="background:${bg};transition:background .1s" onmouseenter="this.style.background='#f0f9ff'" onmouseleave="this.style.background='${bg}'">
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#0f172a;white-space:nowrap">${escapeHtml(ag.protocolo||'-')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">
          <span style="padding:3px 10px;border-radius:99px;font-size:11px;font-weight:700;background:${color}18;color:${color};white-space:nowrap">${escapeHtml(label)}</span>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#475569;white-space:nowrap">${escapeHtml(ag.dataAgendada||'-')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#475569;white-space:nowrap">${escapeHtml(ag.horaAgendada||'-')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ag.fornecedor||'')}">${escapeHtml(ag.fornecedor||'-')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(ag.transportadora||'')}">${escapeHtml(ag.transportadora||'-')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#475569;white-space:nowrap">${escapeHtml(ag.doca?.codigo || ag.docaCodigo || String(ag.docaId||'-'))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#475569;text-align:right">${escapeHtml(formatIntegerBR(ag.quantidadeNotas||0))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#475569;text-align:right;white-space:nowrap">${escapeHtml(formatDecimalBR(ag.pesoTotalKg||ag.quantidadePeso||0,3))} kg</td>
      </tr>`;
    }).join('');
  }

  function formatAuditDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR');
  }

  function renderAuditoria(items = []) {
    const wrap = byId('ocorrenciasWorkflowList');
    if (!wrap) return;
    if (!Array.isArray(items) || !items.length) {
      wrap.innerHTML = '<div class="warning-box">Nenhuma ocorrência registrada até o momento.</div>';
      return;
    }
    wrap.innerHTML = items.map((item) => {
      const detalhes = item?.detalhes || {};
      const notas = Array.isArray(detalhes?.notas) ? detalhes.notas : [];
      const notasTexto = notas.length
        ? notas.map((nota) => {
            const partes = [`NF ${nota?.numeroNf || '-'}`];
            if (nota?.destino) partes.push(`Destino ${nota.destino}`);
            if (Number(nota?.volumes || 0)) partes.push(`Vol ${formatDecimalBR(nota.volumes || 0, 3)}`);
            if (Number(nota?.peso || 0)) partes.push(`Peso ${formatDecimalBR(nota.peso || 0, 3)} kg`);
            return partes.join(' • ');
          }).join('<br>')
        : '-';
      return `
        <div class="occurrence-log-card">
          <div class="occurrence-log-head">
            <strong>${escapeHtml(detalhes?.fornecedor || '-')}</strong>
            <span>${escapeHtml(formatDateTimeBR(item?.createdAt || ''))}</span>
          </div>
          <div class="occurrence-log-meta">
            <span><strong>Transportadora:</strong> ${escapeHtml(detalhes?.transportadora || '-')}</span>
            <span><strong>Operador:</strong> ${escapeHtml(item?.usuarioNome || item?.perfil || '-')}</span>
            <span><strong>NF registradas:</strong> ${escapeHtml(formatIntegerBR(detalhes?.totalNotas || notas.length || 0))}</span>
            <span><strong>Removidas da fila:</strong> ${escapeHtml(formatIntegerBR(detalhes?.removal?.removed || 0))}</span>
          </div>
          ${detalhes?.motivo ? `<div class="occurrence-log-reason"><strong>Motivo:</strong> ${escapeHtml(detalhes.motivo)}</div>` : ''}
          <div class="occurrence-log-notes">${notasTexto}</div>
        </div>
      `;
    }).join('');
  }

  async function loadAuditoria() {
    if (!hasPermission('agendamentos.view')) return [];
    try {
      const items = await api('/api/agendamentos/ocorrencias?limit=40');
      state.auditoria = Array.isArray(items) ? items : [];
      renderAuditoria(state.auditoria);
      return state.auditoria;
    } catch {
      state.auditoria = [];
      renderAuditoria([]);
      return [];
    }
  }

  function buildDocaModalHtml(doca = {}, { isADefinir = false, docaOptions = [] } = {}) {
    const fila = Array.isArray(doca?.fila) ? doca.fila : [];
    const linhas = fila.map((item) => {
      const notas = Array.isArray(item?.notasDetalhes) ? item.notasDetalhes : [];
      const nfList = notas.length ? notas.map((nota) => escapeHtml(nota.numeroNf || '-')).join(', ') : '-';
      const destinos = Array.isArray(item?.destinos) && item.destinos.length ? item.destinos.join(', ') : '-';
      const definirBtn = isADefinir
        ? `<td style="padding:8px"><button type="button" class="btn-definir-doca" data-ag-id="${escapeHtml(String(item.agendamentoId||item.id||''))}" style="padding:5px 10px;border-radius:7px;border:1px solid #3b82f6;background:#eff6ff;color:#1d4ed8;font-size:12px;cursor:pointer">📍 Definir doca</button></td>`
        : '';
      return `<tr>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(String(item.horaAgendada||'-'))}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(item.protocolo || '-')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(item.fornecedor||'-')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(item.transportadora||'-')}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${nfList}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(destinos)}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(formatDecimalBR(item.totalVolumes || 0, 3))}</td>
        <td style="padding:8px;border-bottom:1px solid #f1f5f9;font-size:13px">${escapeHtml(formatDecimalBR(item.pesoTotalKg || 0, 3))} kg</td>
        ${definirBtn}
      </tr>`;
    }).join('');
    const thDefinir = isADefinir ? '<th style="padding:8px">Ação</th>' : '';
    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
        ${[['Agendamentos',formatIntegerBR(doca.totalAgendamentos||fila.length||0)],['NFs',formatIntegerBR(doca.totalNotas||0)],['Volumes',formatDecimalBR(doca.totalVolumes||0,3)],['Peso',formatDecimalBR(doca.totalPesoKg||0,3)+' kg']].map(([l,v])=>`<div style="background:#f8fafc;border-radius:8px;padding:10px;text-align:center"><div style="font-size:10px;color:#64748b;text-transform:uppercase">${l}</div><div style="font-size:18px;font-weight:700">${escapeHtml(v)}</div></div>`).join('')}
      </div>
      <div style="overflow-x:auto" id="docaFilaWrap">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>${['Hora','Agendamento','Fornecedor','Transportadora','NF(s)','Destino(s)','Volumes','Peso',thDefinir?'Ação':''].filter(Boolean).map((h)=>`<th style="text-align:left;padding:8px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b;white-space:nowrap">${h}</th>`).join('')}</tr></thead>
          <tbody id="docaFilaBody">${linhas || '<tr><td colspan="8" style="padding:12px;text-align:center;color:#64748b">Sem agendamentos para esta data.</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  async function loadDocas() {
    if (!hasPermission('docas.view')) return;
    const date = byId('docaData')?.value || '';
    const [data, allDocasCad] = await Promise.all([
      api(`/api/dashboard/docas${date ? `?dataAgendada=${encodeURIComponent(date)}` : ''}`),
      api('/api/cadastros/docas').catch(() => [])
    ]);
    const wrap = byId('docaPainel');
    if (!wrap) return;

    wrap.innerHTML = data.map((d) => {
      const isADefinir = String(d.codigo || '').toLowerCase().includes('definir') || String(d.codigo || '').toLowerCase() === 'a definir';
      const fila = Array.isArray(d.fila) ? d.fila : [];
      return `<div class="doca-card sem-${String(d.semaforo).toLowerCase()}">
        <button type="button" class="doca-card-toggle" data-doca-open="${escapeHtml(String(d.docaId||d.codigo))}">
          <div>
            <h3>${isADefinir ? '⚠️ ' : ''}${escapeHtml(d.codigo)}</h3>
            <small>${escapeHtml(d.descricao || '')}</small>
          </div>
          <span class="badge ${statusTone(d.ocupacaoAtual, d.semaforo)}">${escapeHtml(d.semaforo)}</span>
        </button>
        <div class="doca-detail-summary mt12 doca-meta-summary">
          <span><strong>Agendamentos:</strong> ${escapeHtml(formatIntegerBR(d.totalAgendamentos || fila.length || 0))}</span>
          <span><strong>Total NF:</strong> ${escapeHtml(formatIntegerBR(d.totalNotas || 0))}</span>
          <span><strong>Peso:</strong> ${escapeHtml(formatDecimalBR(d.totalPesoKg || 0, 3))} kg</span>
          <span><strong>Volumes:</strong> ${escapeHtml(formatDecimalBR(d.totalVolumes || 0, 3))}</span>
        </div>
      </div>`;
    }).join('');

    wrap.querySelectorAll('[data-doca-open]').forEach((btn) => btn.addEventListener('click', async () => {
      const key = String(btn.dataset.docaOpen || '').trim();
      const doca = (Array.isArray(data) ? data : []).find((item) => String(item.docaId || item.codigo) === key);
      if (!doca) return;
      const isADefinir = String(doca.codigo || '').toLowerCase().includes('definir') || String(doca.codigo || '').toLowerCase() === 'a definir';
      const modalHtml = buildDocaModalHtml(doca, { isADefinir, docaOptions: Array.isArray(allDocasCad) ? allDocasCad : [] });

      // Wire "Definir doca" buttons BEFORE awaiting (inject into modal body before it's shown)
      showHtmlModal({ title: (isADefinir ? '⚠️ ' : '') + `Doca ${doca.codigo || ''}`.trim(), html: modalHtml, confirmText: 'Fechar', wide: true });
      // Give DOM a tick to render then wire
      setTimeout(() => {
        document.querySelectorAll('.btn-definir-doca').forEach((btn2) => {
          btn2.addEventListener('click', async (e) => {
            e.stopPropagation();
            const agId = btn2.dataset.agId;
            if (!agId) return;
            const docasList = Array.isArray(allDocasCad) ? allDocasCad.filter((dc) => !String(dc.codigo||'').toLowerCase().includes('definir')) : [];
            if (!docasList.length) { alert('Nenhuma doca disponível.'); return; }
            // Show inline dropdown
            const cell = btn2.closest('td');
            if (!cell) return;
            const optionsHtml = docasList.map((dc) => `<option value="${escapeHtml(String(dc.id))}">${escapeHtml(dc.codigo)}</option>`).join('');
            cell.innerHTML = `<select id="selDefinirDoca${agId}" style="padding:7px 10px;border-radius:8px;border:1px solid #3b82f6;font-size:13px;min-width:140px"><option value="">Escolha a doca...</option>${optionsHtml}</select>`;
            cell.querySelector('select').addEventListener('change', async (ev) => {
              const docaId = ev.target.value;
              if (!docaId) return;
              try {
                await api(`/api/agendamentos/${agId}/definir-doca`, { method: 'PATCH', body: JSON.stringify({ docaId: Number(docaId) }) });
                cell.innerHTML = '<span style="color:#10b981;font-weight:600;font-size:12px">✓ Doca definida</span>';
                setTimeout(() => loadDocas(), 800);
              } catch (err) { cell.innerHTML = `<span style="color:#ef4444;font-size:12px">${err.message}</span>`; }
            });
          });
        });
      }, 80);
    }));
  }

  function normalizeValueByField(field, value) {
    if (field.type === "number") return value === "" ? 0 : Number(value);
    if (field.isArray) {
      return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
    }
    return value;
  }

  function buildField(field, value = "") {
    const wrapperClass = field.full ? "form-group form-group-full" : "form-group";
    const requiredAttr = field.required ? "required" : "";
    // Arrays (e.g. fornecedoresVinculados) are displayed as comma-separated text
    const safeValue = Array.isArray(value) ? value.join(", ") : (value ?? "");

    if (field.type === "info") {
      return `
        <div class="${wrapperClass} form-group-full">
          <label>${field.label}</label>
          <p style="margin:4px 0 0;font-size:13px;color:#475569;background:#f1f5f9;border-radius:8px;padding:8px 12px">${escapeHtml(field.value || '')}</p>
        </div>
      `;
    }

    if (field.type === "select") {
      return `
        <div class="${wrapperClass}">
          <label for="cad_${field.name}">${field.label}</label>
          <select id="cad_${field.name}" name="${field.name}" ${requiredAttr}>
            ${field.options.map((opt) => `<option value="${escapeHtml(opt.value)}" ${String(safeValue) === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.text)}</option>`).join("")}
          </select>
        </div>
      `;
    }

    return `
      <div class="${wrapperClass}">
        <label for="cad_${field.name}">${field.label}</label>
        <input id="cad_${field.name}" name="${field.name}" type="${field.type || "text"}" value="${escapeHtml(safeValue)}" ${requiredAttr} />
      </div>
    `;
  }

  function renderCadastroForm(record = null) {
    const config = CADASTRO_CONFIG[state.cadastroTipo];
    if (!config) return;
    byId("cadastroTitulo").textContent = config.titulo;
    byId("cadastroForm").innerHTML = config.fields.map((field) => buildField(field, record ? record[field.name] : "")).join("");
    state.cadastroEditId = record?.id || null;
    byId("cadastroMsg").textContent = state.cadastroEditId ? `Modo edição: ID ${state.cadastroEditId}` : "Modo novo cadastro";
    applyInputMasks(byId("cadastroForm"));
    applyRoleAccess();
  }

  function getCadastroPayload() {
    const config = CADASTRO_CONFIG[state.cadastroTipo];
    const payload = {};
    config.fields.forEach((field) => {
      if (field.type === 'info') return;
      // Read directly from DOM element so disabled fields are still included.
      // FormData skips disabled inputs, which silently wipes isArray fields like fornecedoresVinculados.
      const el = byId(`cad_${field.name}`);
      const value = el ? el.value : '';
      payload[field.name] = normalizeValueByField(field, value);
    });
    return payload;
  }

  function renderCadastroList(items) {
    state.cadastroCache = Array.isArray(items) ? items : [];
    if (!state.cadastroCache.length) {
      byId("cadastroList").innerHTML = "<p>Nenhum registro encontrado.</p>";
      return;
    }
    const cols = Array.from(new Set(state.cadastroCache.flatMap((item) => Object.keys(item)))).filter((col) => typeof state.cadastroCache[0][col] !== "object");
    byId("cadastroList").innerHTML = `
      <table class="table">
        <thead>
          <tr>${cols.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}<th>Ações</th></tr>
        </thead>
        <tbody>
          ${state.cadastroCache.map((item) => `
            <tr>
              ${cols.map((col) => `<td>${escapeHtml(item[col] ?? "")}</td>`).join("")}
              <td><button type="button" class="btn-edit" data-edit-id="${item.id}">Editar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    byId("cadastroList").querySelectorAll("[data-edit-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const record = state.cadastroCache.find((item) => Number(item.id) === Number(btn.dataset.editId));
        if (record) renderCadastroForm(record);
      });
    });
  }

  async function loadCadastro() {
    if (!hasPermission('cadastros.view')) return;
    if (state.cadastroTipo === "usuarios" && !hasPermission('users.manage')) {
      byId("cadastroMsg").textContent = "Apenas administradores podem acessar o cadastro de usuários.";
      state.cadastroTipo = "fornecedores";
      renderCadastroForm();
      applyRoleAccess();
    }
    const config = CADASTRO_CONFIG[state.cadastroTipo];
    const items = await api(config.endpoint);
    renderCadastroList(items);
  }

  async function saveCadastro() {
    if (!hasPermission('cadastros.manage') || (state.cadastroTipo === "usuarios" && !hasPermission('users.manage'))) {
      byId("cadastroMsg").textContent = "Seu perfil não pode alterar este cadastro.";
      return;
    }
    const config = CADASTRO_CONFIG[state.cadastroTipo];
    const payload = getCadastroPayload();
    let endpoint = config.endpoint;
    let method = "POST";
    if (state.cadastroEditId) {
      endpoint = `${config.endpoint}/${state.cadastroEditId}`;
      method = "PUT";
    }
    await api(endpoint, { method, body: JSON.stringify(payload) });
    byId("cadastroMsg").textContent = state.cadastroEditId ? "Cadastro atualizado com sucesso." : "Cadastro salvo com sucesso.";
    renderCadastroForm();
    await loadCadastro();
    await fillSelects();
  }

  async function loadAgendamentos() {
    if (!hasPermission('agendamentos.view')) return;
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k, v]) => { if (v) params.set(k, v); });
    const items = await api(`/api/agendamentos?${params.toString()}`);
    const inConfirmacoes = !!byId('confirmacoes')?.classList.contains('active');
    state.confirmacoesSelecionados = new Set();
    renderOperationalTable(items || [], {
      targetId: 'agendamentosList',
      includeActions: false,
      includeSelect: inConfirmacoes && hasPermission('agendamentos.request_reschedule'),
    });
    updateConfirmacoesToolbar();
    await Promise.allSettled([maybeShowMissingRelatorioAlerts(items || []), loadAuditoria()]);
  }

  function buildAwarenessMessage(analysis) {
    const items = Array.isArray(analysis?.notasComCiencia) ? analysis.notasComCiencia : [];
    if (!items.length) return 'Existem notas com vencimento próximo da data agendada. Deseja confirmar a ciência e prosseguir?';
    return [
      'As notas abaixo estão com o 1º vencimento muito próximo da data agendada:',
      '',
      ...items.map((nota) => `NF ${nota.numeroNf || '-'} / Série ${nota.serie || '-'} — 1º vencimento ${nota.dataPrimeiroVencimentoBr || '-'}${nota.diasEntreAgendamentoEVencimento != null ? ` — diferença de ${nota.diasEntreAgendamentoEVencimento} dia(s)` : ''}`),
      '',
      'Deseja confirmar a ciência e prosseguir com o agendamento?'
    ].join('\n');
  }

  async function confirmAwarenessForPayload(payload) {
    const analysis = await api('/api/agendamentos/analise-vencimento', { method: 'POST', body: JSON.stringify(payload) });
    if (!analysis?.requiresAwareness) return { confirmed: false, analysis };
    const confirmed = await showAppModal({
      title: 'Ciência obrigatória',
      message: buildAwarenessMessage(analysis),
      confirmText: 'Estou ciente e quero prosseguir',
      cancelText: 'Cancelar',
      tone: 'warning'
    });
    return { confirmed, analysis };
  }

  async function confirmAwarenessForExistingAgendamento(id, body = {}) {
    const analysis = await api(`/api/agendamentos/${id}/analise-vencimento`, { method: 'POST', body: JSON.stringify(body) });
    if (!analysis?.requiresAwareness) return { confirmed: false, analysis };
    const confirmed = await showAppModal({
      title: 'Ciência obrigatória',
      message: buildAwarenessMessage(analysis),
      confirmText: 'Estou ciente e quero prosseguir',
      cancelText: 'Cancelar',
      tone: 'warning'
    });
    return { confirmed, analysis };
  }

  async function maybeShowMissingRelatorioAlerts(items = []) {
    // Notificação desabilitada: notas manuais ou fora do relatório são permitidas
    return;
  }

  function renderConsultaAgendamentoNotas(item, { targetDigits = '', searchByDateOnly = false } = {}) {
    const notas = Array.isArray(item?.notasFiscais) ? item.notasFiscais : Array.isArray(item?.notas) ? item.notas : [];
    if (!notas.length) return '<span>-</span>';
    const filtered = searchByDateOnly
      ? notas
      : (targetDigits ? notas.filter((nota) => normalizeDigitsValue(nota?.numeroNf || '').includes(targetDigits)) : notas);
    const source = filtered.length ? filtered : notas;
    return `<div class="consulta-nf-agendamento-nfs">${source.map((nota) => {
      const numero = `NF ${String(nota?.numeroNf || '-').trim() || '-'}`;
      const serie = String(nota?.serie || '').trim();
      const label = serie ? `${numero} • Série ${serie}` : numero;
      return `<span class="nf-series-item consulta-nf-agendamento-nf-item">${escapeHtml(label)}</span>`;
    }).join('')}</div>`;
  }

  function renderConsultaNfResult(data = {}) {
    const relatorio = Array.isArray(data.relatorio) ? data.relatorio : [];
    const agendamentos = Array.isArray(data.agendamentos) ? data.agendamentos : [];
    const resumo = data.resumo || {};
    const mode = String(data.modoConsulta || 'NF').toUpperCase();
    const searchByDateOnly = mode === 'DATA';
    const targetDigits = normalizeDigitsValue(data.numeroNf || '');
    if (!relatorio.length && !agendamentos.length) {
      return `<div class="warning-box">${searchByDateOnly ? 'Nenhum agendamento encontrado para a data informada.' : 'Nenhum registro encontrado para a NF informada.'}</div>`;
    }

    const summaryCards = searchByDateOnly
      ? `
        <div class="consulta-nf-summary-card"><span>Consulta</span><strong>Por data</strong></div>
        <div class="consulta-nf-summary-card"><span>Agendamentos do dia</span><strong>${escapeHtml(formatIntegerBR(resumo.totalAgendamentosDaConsulta || resumo.totalAgendamentosNoDia || 0))}</strong></div>
        <div class="consulta-nf-summary-card"><span>Notas agendadas no dia</span><strong>${escapeHtml(formatIntegerBR(resumo.totalNotasNoDia || 0))}</strong></div>
        <div class="consulta-nf-summary-card"><span>Data consultada</span><strong>${escapeHtml(formatDateBR(data.dataAgendada || '') || '-')}</strong></div>
      `
      : `
        <div class="consulta-nf-summary-card"><span>Situação da NF</span><strong>${resumo.agendada ? 'Agendada' : 'Sem agendamento'}</strong></div>
        <div class="consulta-nf-summary-card"><span>Ocorrências no relatório</span><strong>${escapeHtml(formatIntegerBR(resumo.totalOcorrenciasRelatorio || 0))}</strong></div>
        <div class="consulta-nf-summary-card"><span>Agendamentos na data</span><strong>${escapeHtml(formatIntegerBR(resumo.totalAgendamentosNoDia || 0))}</strong></div>
        <div class="consulta-nf-summary-card"><span>Notas agendadas na data</span><strong>${escapeHtml(formatIntegerBR(resumo.totalNotasNoDia || 0))}</strong></div>
        <div class="consulta-nf-summary-card"><span>Esta NF na data</span><strong>${escapeHtml(formatIntegerBR(resumo.totalAgendamentosDestaNfNoDia || 0))}</strong></div>
      `;

    return `
      <div class="consulta-nf-summary-grid">${summaryCards}</div>
      <div class="consulta-nf-result-grid">
        <div class="result-card">
          <h3>${searchByDateOnly ? 'Relatório terceirizado' : `Relatório terceirizado (${relatorio.length})`}</h3>
          ${searchByDateOnly
            ? '<p class="hint">Na consulta apenas por data, o foco é a lista de agendamentos internos do dia escolhido.</p>'
            : relatorio.length
              ? `<table class="table"><thead><tr><th>Fornecedor</th><th>Empresa</th><th>Destino</th><th>NF</th><th>Série</th><th>Data entrada</th><th>1º vencimento</th><th>Status</th><th>Agendada?</th></tr></thead><tbody>${relatorio.map((item) => `<tr><td>${escapeHtml(item.fornecedor || '-')}</td><td>${escapeHtml(item.empresa || '-')}</td><td>${renderStoreLogo(item.destino || item.empresa, { showEmpty: true })}</td><td>${escapeHtml(item.numeroNf || '-')}</td><td>${escapeHtml(item.serie || '-')}</td><td>${escapeHtml(item.dataEntradaBr || '-')}</td><td>${escapeHtml(item.dataPrimeiroVencimentoBr || '-')}</td><td>${escapeHtml(item.status || '-')}</td><td>${item.agendamentoId ? 'Sim' : (resumo.agendada ? 'Sim' : 'Não')}</td></tr>`).join('')}</tbody></table>`
              : '<p class="hint">NF não localizada no relatório terceirizado atual.</p>'}
        </div>
        <div class="result-card">
          <h3>${searchByDateOnly ? `Agendamentos do dia (${agendamentos.length})` : `Agendamentos vinculados (${agendamentos.length})`}</h3>
          ${agendamentos.length ? `<table class="table"><thead><tr><th>ID</th><th>Protocolo</th><th>Status</th><th>Usuário</th><th>Fornecedor</th><th>NF(s)</th><th>Data agendada</th><th>Faltam</th><th>Hora</th><th>Data entrada</th><th>1º vencimento</th></tr></thead><tbody>${agendamentos.map((item) => {
            const notas = Array.isArray(item.notasFiscais) ? item.notasFiscais : [];
            const notaConsultada = (targetDigits ? notas.find((nota) => normalizeDigitsValue(nota?.numeroNf || '').includes(targetDigits)) : null) || notas[0] || {};
            const faltam = item.diasParaAgendamento == null ? formatRemainingDaysLabel(item.dataAgendada || '') : (Number(item.diasParaAgendamento) === 0 ? 'Hoje' : Number(item.diasParaAgendamento) > 0 ? `${Number(item.diasParaAgendamento)} dia(s)` : `${Math.abs(Number(item.diasParaAgendamento))} dia(s) atrás`);
            return `<tr><td>${escapeHtml(item.id || '-')}</td><td>${escapeHtml(item.protocolo || '-')}</td><td>${renderStatusBadge(item.status, item.semaforo || '')}</td><td>${escapeHtml(item.usuarioAgendamento || '-')}</td><td>${escapeHtml(item.fornecedor || '-')}</td><td>${renderConsultaAgendamentoNotas(item, { targetDigits, searchByDateOnly })}</td><td>${escapeHtml(formatDateBR(item.dataAgendada || ''))}</td><td>${escapeHtml(faltam)}</td><td>${escapeHtml(formatHour(item.horaAgendada || ''))}</td><td>${escapeHtml(notaConsultada?.dataEntradaBr || notaConsultada?.dataEntrada || '-')}</td><td>${escapeHtml(notaConsultada?.dataPrimeiroVencimentoBr || notaConsultada?.dataPrimeiroVencimento || '-')}</td></tr>`;
          }).join('')}</tbody></table>` : `<p class="hint">${searchByDateOnly ? 'Nenhum agendamento encontrado para a data informada.' : 'Nenhum agendamento encontrado para esta NF. Situação atual: não agendada.'}</p>`}
        </div>
      </div>
    `;
  }

  async function consultarNfInterna(numeroNf, dataAgendada = '') {
    const params = new URLSearchParams();
    if (String(numeroNf || '').trim()) params.set('numeroNf', numeroNf);
    if (dataAgendada) params.set('dataAgendada', normalizeDateToIso(dataAgendada));
    const result = await api(`/api/agendamentos/consulta-nf?${params.toString()}`);
    const target = byId('consultaNfResult');
    if (target) target.innerHTML = renderConsultaNfResult(result);
  }

  function currentId() {
    const id = byId("agendamentoId")?.value;
    if (!id) throw new Error("Informe o ID do agendamento.");
    return id;
  }

  async function postStatus(path, body = {}) {
    return api(`/api/agendamentos/${currentId()}/${path}`, { method: "POST", body: JSON.stringify(body) });
  }

  async function handleOp(fn, success) {
    try {
      const result = await fn();
      if (result === undefined || result === false) return;
      byId("operacaoMsg").textContent = success;
      await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas(), loadFilterOptions()]);
    } catch (err) {
      byId("operacaoMsg").textContent = err.message;
    }
  }

  async function validateCheckin(token) {
    try {
      const reference = parseOperationReference(token);
      const currentParams = new URLSearchParams(window.location.search || '');
      const normalizedToken = reference.token;
      const rawToken = String(token || '').trim();
      const lookupId = reference.id || String(currentParams.get('id') || '').replace(/\D/g, '').trim();
      const tokenInput = byId('checkinForm')?.querySelector('[name="token"]');
      if (tokenInput) tokenInput.value = rawToken || normalizedToken;
      if (!normalizedToken) throw new Error('Informe o token da operação.');
      const modo = byId("checkinForm")?.querySelector("[name=modo]")?.value || "checkin";
      const endpoint = modo === "checkout" ? `/api/public/checkout/${encodeURIComponent(normalizedToken)}` : `/api/public/checkin/${encodeURIComponent(normalizedToken)}`;
      const requestBody = { token: normalizedToken, lookupId, rawToken: rawToken || normalizedToken };
      let data;
      try {
        let requestOptions = { method: "POST", body: JSON.stringify(requestBody) };
        if (modo === 'checkout') {
          let checkoutContext = null;
          try {
            const params = new URLSearchParams();
            if (normalizedToken) params.set('token', normalizedToken);
            if (lookupId) params.set('id', lookupId);
            checkoutContext = await api(`/api/public/checkout-context?${params.toString()}`);
          } catch (_ctxErr) {}
          const completion = await showCheckoutCompletionForm({
            title: 'Concluir check-out',
            contextLabel: 'Informe como foi a descarga antes de concluir o check-out.',
            notasFiscais: Array.isArray(checkoutContext?.notasFiscais) ? checkoutContext.notasFiscais : []
          });
          if (!completion) return;
          const payload = { ...requestBody, ...completion, teveOcorrencia: completion.houveAvaria, descricaoOcorrencia: completion.observacaoAvaria, descargaConcluida: completion.comoFoiDescarga };
          if (completion.imagensAvaria?.length) requestOptions = { method: 'POST', body: buildMultipartFormData(payload) };
          else requestOptions = { method: 'POST', body: JSON.stringify(payload) };
        }
        data = await api(endpoint, requestOptions);
      } catch (err) {
        const message = String(err.message || '');
        const requiresManualAuthorization = !!err?.data?.requiresManualAuthorization;
        const canManualOverride = ['ADMIN', 'GESTOR', 'OPERADOR', 'PORTARIA'].includes(currentProfile());
        if (modo === 'checkin' && requiresManualAuthorization && canManualOverride) {
          const liberar = await showAppModal({ title: 'Autorização manual', message, confirmText: 'Autorizar', cancelText: 'Cancelar', tone: 'warning' });
          if (!liberar) throw err;
          data = await api(endpoint, { method: "POST", body: JSON.stringify({ ...requestBody, overrideManualAuthorization: true, overrideDateMismatch: true, overrideTimeMismatch: true }) });
        } else if (modo === 'checkout' && err?.data?.requiresStartUnload) {
          throw new Error(err?.data?.message || 'O check-out só pode ser executado após o início da descarga.');
        } else {
          throw err;
        }
      }
      byId("checkinMsg").textContent = data.message;
      byId("checkinResult").textContent = JSON.stringify(data.agendamento, null, 2);
      stopCameraScan();
      await Promise.allSettled([loadDashboard(), loadAgendamentos(), loadDocas(), loadFilterOptions()]);
    } catch (err) {
      byId("checkinMsg").textContent = err.message;
    }
  }

  async function loadAvaliacaoForm(token) {
    state.avaliacaoToken = String(token || '').trim();
    const intro = byId('avaliacaoIntro');
    const msg = byId('avaliacaoMsg');
    const form = byId('avaliacaoForm');
    if (msg) msg.textContent = '';
    if (!state.avaliacaoToken) {
      if (intro) intro.innerHTML = '';
      if (msg) msg.textContent = 'Token de avaliação não informado.';
      return;
    }
    const data = await api(`/api/public/avaliacao/${encodeURIComponent(state.avaliacaoToken)}`);
    if (intro) {
      intro.innerHTML = `
        <div><span class="field-label">Protocolo</span><strong>${escapeHtml(data.protocolo || '-')}</strong></div>
        <div><span class="field-label">Fornecedor</span><strong>${escapeHtml(data.fornecedor || '-')}</strong></div>
        <div><span class="field-label">Transportadora</span><strong>${escapeHtml(data.transportadora || '-')}</strong></div>
        <div><span class="field-label">Motorista</span><strong>${escapeHtml(data.motorista || '-')}</strong></div>
        <div><span class="field-label">CPF</span><strong>${escapeHtml(data.cpfMotorista || '-')}</strong></div>
        <div><span class="field-label">Placa</span><strong>${escapeHtml(data.placa || '-')}</strong></div>
        <div><span class="field-label">Data agendada</span><strong>${escapeHtml(formatDateBR(data.dataAgendada || '-') || '-')}</strong></div>
        <div><span class="field-label">Hora agendada</span><strong>${escapeHtml(data.horaAgendada || '-')}</strong></div>
      `;
    }
    if (form) {
      form.reset();
      Array.from(form.elements).forEach((el) => { if (el?.tagName) el.disabled = !!data.respondeu; });
    }
    if (msg && data.respondeu) msg.textContent = 'Esta avaliação já foi respondida. Obrigado pelo retorno.';
  }

  function bindViewNavigation() {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.setAttribute("type", "button");
      if (btn.dataset.navBound === "true") return;
      btn.dataset.navBound = "true";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showView(btn.dataset.view);
      });
    });
  }

  function showPasswordChangeModal(tempToken) {
    const existing = byId('passwordChangeModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'passwordChangeModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:18px;padding:32px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <h3 style="margin:0 0 8px;font-size:20px;color:#0f172a">Definir nova senha</h3>
        <p style="margin:0 0 20px;font-size:14px;color:#64748b">Este é seu primeiro acesso. Crie uma senha pessoal para continuar.</p>
        <div style="display:grid;gap:12px">
          <div>
            <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Nova senha</label>
            <input id="pcNovaSenha" type="password" placeholder="Mínimo 6 caracteres"
              style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;font-size:14px" />
          </div>
          <div>
            <label style="font-size:12px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Confirmar senha</label>
            <input id="pcConfirmarSenha" type="password" placeholder="Repita a senha"
              style="width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1.5px solid #cbd5e1;font-size:14px" />
          </div>
          <p id="pcMsg" style="margin:0;font-size:13px;color:#ef4444;min-height:18px"></p>
          <button id="pcSubmit" style="padding:12px;border-radius:12px;font-size:15px;font-weight:700;background:#2563eb;color:#fff;border:none;cursor:pointer">
            Salvar e entrar
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const nova = modal.querySelector('#pcNovaSenha');
    const confirmar = modal.querySelector('#pcConfirmarSenha');
    const msg = modal.querySelector('#pcMsg');
    const btn = modal.querySelector('#pcSubmit');
    setTimeout(() => nova.focus(), 50);

    btn.addEventListener('click', async () => {
      msg.textContent = '';
      const s1 = nova.value;
      const s2 = confirmar.value;
      if (s1.length < 6) { msg.textContent = 'A senha deve ter pelo menos 6 caracteres.'; return; }
      if (s1 !== s2) { msg.textContent = 'As senhas não conferem.'; return; }
      btn.disabled = true;
      try {
        const data = await api('/api/auth/trocar-senha-provisoria', {
          method: 'POST',
          body: JSON.stringify({ tempToken, novaSenha: s1 })
        });
        modal.remove();
        state.token = data.token;
        localStorage.setItem('token', data.token);
        state.currentUser = data.user || null;
        syncCurrentUserFromToken();
        if (typeof refreshWatermark === 'function') refreshWatermark();
        updateNav();
        startNotifPolling();
        await fillSelects();
        showView('dashboard');
        await loadDashboard();
        byId('loginMsg').textContent = `Logado como ${data.user.nome} (${data.user.perfil})`;
      } catch (err) {
        msg.textContent = err.message || 'Erro ao salvar senha.';
        btn.disabled = false;
      }
    });

    [nova, confirmar].forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') btn.click();
    }));
  }

  function show2FAStep(email) {
    const loginCard = byId('loginForm')?.closest('.card') || byId('loginForm')?.parentNode;
    if (!loginCard) return;
    const existing = byId('twoFAStep');
    if (existing) { existing.style.display = 'block'; return; }
    const div = document.createElement('div');
    div.id = 'twoFAStep';
    div.style.cssText = 'margin-top:16px;display:grid;gap:10px';
    div.innerHTML = `
      <p style="margin:0;font-size:14px;color:#334155">Digite o código de 6 dígitos enviado para seu e-mail:</p>
      <input id="twoFACode" type="text" maxlength="6" placeholder="000000" inputmode="numeric"
        style="font-size:28px;letter-spacing:10px;text-align:center;padding:14px;border-radius:12px;border:2px solid #2563eb;font-weight:700" />
      <button id="btnVerify2FA" style="padding:12px;border-radius:12px;font-size:15px;font-weight:700">Verificar código</button>
      <button id="btnResend2FA" style="background:#475569;padding:10px;border-radius:10px;font-size:13px">Reenviar código</button>
      <p id="twoFAMsg" style="margin:0;font-size:13px;color:#ef4444"></p>`;
    loginCard.appendChild(div);

    div.querySelector('#btnVerify2FA').onclick = async () => {
      const code = div.querySelector('#twoFACode').value.trim();
      const msgEl = div.querySelector('#twoFAMsg');
      if (code.length !== 6) { msgEl.textContent = 'Digite os 6 dígitos.'; return; }
      try {
        const data = await api('/api/auth/verify-2fa', { method: 'POST', body: JSON.stringify({ email, code }) });
        state.token = data.token;
        localStorage.setItem('token', data.token);
        state.currentUser = data.user || null;
        syncCurrentUserFromToken();
        if (typeof refreshWatermark === 'function') refreshWatermark();
        div.remove();
        updateNav();
        startNotifPolling();
        await fillSelects();
        showView('dashboard');
        await loadDashboard();
        byId('loginMsg').textContent = `Logado como ${data.user.nome} (${data.user.perfil})`;
      } catch (err) {
        msgEl.textContent = err.message || 'Código inválido.';
      }
    };
    div.querySelector('#twoFACode').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') div.querySelector('#btnVerify2FA').click();
    });
    div.querySelector('#btnResend2FA').onclick = async () => {
      try {
        const form = byId('loginForm');
        const fd = new FormData(form);
        await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, senha: fd.get('senha') || '' }) });
        div.querySelector('#twoFAMsg').textContent = 'Novo código enviado!';
        div.querySelector('#twoFAMsg').style.color = '#10b981';
        setTimeout(() => { div.querySelector('#twoFAMsg').textContent = ''; div.querySelector('#twoFAMsg').style.color = '#ef4444'; }, 3000);
      } catch (err) { div.querySelector('#twoFAMsg').textContent = err.message; }
    };
    setTimeout(() => div.querySelector('#twoFACode')?.focus(), 50);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bindViewNavigation();

    try { syncCurrentUserFromToken(); } catch (err) { console.error('[INIT] syncCurrentUserFromToken falhou:', err); }
    try { if (typeof refreshWatermark === 'function') refreshWatermark(); } catch (err) {}
    try { updateNav(); } catch (err) { console.error('[INIT] updateNav falhou:', err); }
    try { renderNfRows(); } catch (err) { console.error('[INIT] renderNfRows falhou:', err); }
    try { renderCadastroForm(); } catch (err) { console.error('[INIT] renderCadastroForm falhou:', err); }
    try { renderPendingNotasInterno(); } catch (err) { console.error('[INIT] renderPendingNotasInterno falhou:', err); }
    byId("loginForm")?.reset();
    applyInputMasks(document);
    const internalDateInput = byId("agendamentoForm")?.querySelector('[name="dataAgendada"]');
    if (internalDateInput && !internalDateInput.value) internalDateInput.value = new Date().toISOString().slice(0, 10);
    // Quando a data mudar no formulário de criação, recarregar janelas disponíveis
    internalDateInput?.addEventListener('change', (e) => {
      loadJanelasDisponiveis(e.target.value, null, null);
    });

    byId("btnLogout")?.addEventListener("click", logout);

    // Admin (React) button removed

    byId('toggleLoginPassword')?.addEventListener('click', () => {
      const input = byId('loginSenha');
      const button = byId('toggleLoginPassword');
      if (!input || !button) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-pressed', show ? 'true' : 'false');
      button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Visualizar senha');
    });

    byId("applyFilters")?.addEventListener("click", async () => {
      try { await loadDashboard(); await loadAgendamentos(); } catch (err) { alert(err.message); }
    });

    byId("clearFilters")?.addEventListener("click", async () => {
      ["fStatus", "fFornecedor", "fTransportadora", "fMotorista", "fPlaca", "fData"].forEach((id) => { if (byId(id)) byId(id).value = ""; });
      try { await loadDashboard(); await loadAgendamentos(); } catch (err) { alert(err.message); }
    });

    byId("loginForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(e.target).entries());
        const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });

        // ── Senha provisória: exige troca antes de emitir sessão ────────────
        if (data.requiresPasswordChange) {
          showPasswordChangeModal(data.tempToken);
          return;
        }

        // ── 2FA: server requires verification code ───────────────────────────
        if (data.requires2FA) {
          byId("loginMsg").textContent = `Código enviado para ${data.email}. Verifique seu e-mail.`;
          show2FAStep(payload.email);
          return;
        }

        // ── Direct login (no 2FA or fallback) ───────────────────────────────
        state.token = data.token;
        localStorage.setItem("token", data.token);
        state.currentUser = data.user || null;
        syncCurrentUserFromToken();
        if (typeof refreshWatermark === 'function') refreshWatermark();
        updateNav();
        startNotifPolling();
        await fillSelects();
        if (!applyCheckinRouteContext({ autoValidate: true })) {
          const requestedView = new URLSearchParams(location.search).get("view");
          if (requestedView === "consulta-nf") {
            showView("consulta-nf");
          } else {
            showView("dashboard");
            await loadDashboard();
          }
        }
        byId("loginMsg").textContent = `Logado como ${data.user.nome} (${data.user.perfil})`;
      } catch (err) {
        byId("loginMsg").textContent = err.message || "Falha no login.";
      }
    });

    byId("loadDashboard")?.addEventListener("click", async () => { try { await loadDashboard(); } catch (err) { alert(err.message); } });
    byId("loadDocas")?.addEventListener("click", async () => { try { await loadDocas(); } catch (err) { alert(err.message); } });

    document.querySelectorAll(".cad-tab").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!canAccessCadastroTab(btn.dataset.tipo)) {
          byId("cadastroMsg").textContent = "Seu perfil não possui acesso a esta aba.";
          return;
        }
        state.cadastroTipo = btn.dataset.tipo;
        setActiveButton(".cad-tab", btn);
        renderCadastroForm();
        try {
          await loadCadastro();
        } catch (err) {
          byId("cadastroMsg").textContent = err.message;
        }
      });
    });

    byId("btnNovoCadastro")?.addEventListener("click", () => renderCadastroForm());
    byId("btnLimparCadastro")?.addEventListener("click", () => renderCadastroForm());
    byId('btnClearInternalFornecedorSelection')?.addEventListener('click', () => {
      clearInternalPendingSelectionState();
      renderInternalFornecedorDropdown();
      renderPendingNotasInterno();
      byId('agendamentoMsg').textContent = 'Seleção de fornecedores limpa.';
    });
    byId('btnRegistrarOcorrencia')?.addEventListener('click', async () => {
      try {
        await registrarOcorrenciaInterna();
      } catch (err) {
        byId('agendamentoMsg').textContent = err.message;
      }
    });
    byId("saveCadastro")?.addEventListener("click", async () => { try { await saveCadastro(); } catch (err) { byId("cadastroMsg").textContent = err.message; } });
    byId("loadCadastro")?.addEventListener("click", async () => { try { await loadCadastro(); } catch (err) { byId("cadastroMsg").textContent = err.message; } });

    byId("agendamentoForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        syncInternalHoraFromJanela();
        const payload = Object.fromEntries(new FormData(e.target).entries());
        payload.dataAgendada = normalizeDateToIso(payload.dataAgendada);
        payload.horaAgendada = formatHour(payload.horaAgendada || syncInternalHoraFromJanela());
        payload.cpfMotorista = String(payload.cpfMotorista || '').replace(/\D/g, '');
        payload.telefoneMotorista = String(payload.telefoneMotorista || '').replace(/\D/g, '');
        payload.notasFiscais = selectedInternalNotas();
        payload.quantidadeNotas = Number(payload.notasFiscais.length || 0);
        payload.quantidadeVolumes = parseNumberBR(byId('internalQuantidadeVolumes')?.value || 0);
        payload.pesoTotalKg = parseNumberBR(byId('internalPesoTotalKg')?.value || 0);
        payload.valorTotalNf = parseNumberBR(byId('internalValorTotalNf')?.value || 0);
        if (!payload.fornecedor && !payload.fornecedorPendenteInterno) throw new Error('Selecione ou informe um fornecedor.');
        // Permite agendamento com 0 NFs (fornecedor manual / sem relatório)
        delete payload.fornecedorPendenteInterno;
        const awareness = await confirmAwarenessForPayload(payload);
        if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
        if (awareness.confirmed) payload.confirmarCienciaVencimento = true;
        const data = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(payload) });
        byId("agendamentoId").value = data.id || "";
        const volumes = Number(data.quantidadeVolumes || 0);
        const notas = Number(data.quantidadeNotas || 0);
        byId("agendamentoMsg").innerHTML = `<span style="color:#10b981;font-weight:700">✓ Agendamento criado</span> — Protocolo: <strong>${escapeHtml(data.protocolo||'-')}</strong> | Status: <strong>${escapeHtml(data.status||'PENDENTE')}</strong> | ${notas} NF(s) | Volumes: <strong>${volumes}</strong>`;
        e.target.reset();
        clearInternalPendingSelectionState();
        const fornecedorField = byId('internalFornecedorNome');
        if (fornecedorField) fornecedorField.value = '';
        renderInternalFornecedorDropdown();
        renderPendingNotasInterno();
        const dataInput = byId('agendamentoForm')?.querySelector('[name="dataAgendada"]');
        if (dataInput) dataInput.value = new Date().toISOString().slice(0, 10);
        applyInputMasks(byId('agendamentoForm'));
        await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas(), loadFornecedoresPendentesInterno(), loadFilterOptions()]);
      } catch (err) {
        byId("agendamentoMsg").textContent = err.message;
      }
    });

    byId("loadAgendamentos")?.addEventListener("click", async () => { try { await loadAgendamentos(); } catch (err) { byId("operacaoMsg").textContent = err.message; } });
    byId("consultaNfForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const formData = new FormData(e.target);
        const numeroNf = String(formData.get('numeroNf') || '').trim();
        const dataAgendada = String(formData.get('dataAgendada') || '').trim();
        if (!numeroNf && !dataAgendada) throw new Error('Informe o número da NF, a data da consulta, ou ambos.');
        await consultarNfInterna(numeroNf, dataAgendada);
      } catch (err) {
        const target = byId('consultaNfResult');
        if (target) target.innerHTML = `<div class="warning-box">${escapeHtml(err.message)}</div>`;
      }
    });
    byId("btnAprovar")?.addEventListener("click", async () => handleOp(async () => {
      // Só envia janelaId — NÃO envia horaAgendada automaticamente da janela,
      // pois isso sobrescreveria a hora original do agendamento (ex.: 08:00 → 15:00).
      // O backend preserva a hora existente do agendamento.
      const body = { janelaId: byId("internalJanelaSelect")?.value };
      syncInternalHoraFromJanela(); // atualiza o input do form localmente, sem enviar ao servidor
      const awareness = await confirmAwarenessForExistingAgendamento(currentId(), body);
      if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
      if (awareness.confirmed) body.confirmarCienciaVencimento = true;
      return postStatus("aprovar", body);
    }, "Agendamento aprovado."));
    byId("btnReprovar")?.addEventListener("click", async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado."));
    byId("btnReagendar")?.addEventListener("click", async () => handleOp(async () => {
      const body = { dataAgendada: new Date().toISOString().slice(0, 10), horaAgendada: syncInternalHoraFromJanela() || undefined, janelaId: byId("internalJanelaSelect")?.value };
      const awareness = await confirmAwarenessForExistingAgendamento(currentId(), body);
      if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
      if (awareness.confirmed) body.confirmarCienciaVencimento = true;
      return postStatus("reagendar", body);
    }, "Agendamento reagendado."));
    byId("btnCancelar")?.addEventListener("click", async () => handleOp(() => postStatus("cancelar", { motivo: "Cancelado via painel" }), "Agendamento cancelado."));

    byId("btnEditarAgendamento")?.addEventListener("click", async () => {
      const id = currentId();
      if (!id) { byId('operacaoMsg').textContent = 'Selecione um agendamento primeiro (clique em "Usar ID").'; return; }
      try {
        const item = await api(`/api/agendamentos/${id}`);
        if (!item || !item.id) { byId('operacaoMsg').textContent = 'Agendamento não encontrado.'; return; }
        const statusBloqueado = ['APROVADO','CHEGOU','EM_DESCARGA','FINALIZADO'].includes(String(item.status||'').toUpperCase());
        if (statusBloqueado) {
          const ok = await showAppModal({
            title: `Agendamento ${item.protocolo} — ${item.status}`,
            message: 'Este agendamento já foi aprovado. Para editar, ele será CANCELADO e você precisará criar um novo. Deseja continuar?',
            confirmText: 'Cancelar e editar', cancelText: 'Voltar', tone: 'warning'
          });
          if (!ok) return;
          await api(`/api/agendamentos/${id}/cancelar`, { method: 'POST', body: JSON.stringify({ motivo: 'Cancelado para edição pelo operador.' }) });
          byId('operacaoMsg').textContent = `Agendamento ${item.protocolo} cancelado. Crie um novo agendamento.`;
          await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadFornecedoresPendentesInterno()]);
          return;
        }
        openInlineEditModal(item);
      } catch (err) { byId('operacaoMsg').textContent = err.message; }
    });
    byId("btnIniciar")?.addEventListener("click", async () => handleOp(() => postStatus("iniciar"), "Descarga iniciada."));
    byId("btnFinalizar")?.addEventListener("click", async () => handleOp(async () => {
      let finalizacaoContext = null;
      try { finalizacaoContext = await api(`/api/agendamentos/${currentId()}`); } catch (_err) {}
      const completion = await showCheckoutCompletionForm({ title: 'Finalizar agendamento', contextLabel: 'Preencha as informações do recebimento antes de finalizar.', notasFiscais: Array.isArray(finalizacaoContext?.notasFiscais) ? finalizacaoContext.notasFiscais : [] });
      if (!completion) return false;
      const payload = { ...completion, teveOcorrencia: completion.houveAvaria, descricaoOcorrencia: completion.observacaoAvaria, descargaConcluida: completion.comoFoiDescarga };
      if (completion.imagensAvaria?.length) {
        return api(`/api/agendamentos/${currentId()}/finalizar`, { method: 'POST', body: buildMultipartFormData(payload) });
      }
      return api(`/api/agendamentos/${currentId()}/finalizar`, { method: 'POST', body: JSON.stringify(payload) });
    }, "Agendamento finalizado."));
    byId("btnNoShow")?.addEventListener("click", async () => handleOp(() => postStatus("no-show"), "Agendamento marcado como no-show."));
    byId("btnVoucher")?.addEventListener("click", () => { try { window.open(`/api/agendamentos/${currentId()}/voucher`, "_blank"); } catch (err) { alert(err.message); } });
    byId("btnQr")?.addEventListener("click", () => { try { window.open(`/api/agendamentos/${currentId()}/qrcode.svg`, "_blank"); } catch (err) { alert(err.message); } });
    byId("btnEnviarInfos")?.addEventListener("click", async () => handleOp(() => api(`/api/agendamentos/${currentId()}/enviar-informacoes`, { method: "POST", body: JSON.stringify({}) }), "Informações enviadas."));


    byId("addNf")?.addEventListener("click", () => {
      syncNfDraftsFromDom();
      state.nfRows += 1;
      ensureNfDraftSize();
      renderNfRows();
    });

    byId("removeNf")?.addEventListener("click", () => {
      syncNfDraftsFromDom();
      if (state.nfRows <= 1) return;
      state.nfRows -= 1;
      ensureNfDraftSize();
      renderNfRows();
    });

    byId("fornecedorForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(e.target).entries());
        payload.cpfMotorista = String(payload.cpfMotorista || '').replace(/\D/g, '');
        payload.telefoneMotorista = String(payload.telefoneMotorista || '').replace(/\D/g, '');
        payload.dataAgendada = normalizeDateToIso(payload.dataAgendada);
        payload.horaAgendada = formatHour(payload.horaAgendada);
        payload.lgpdConsent = !!e.target.querySelector('[name="lgpdConsent"]')?.checked;
        payload.notas = collectNotas();
        updateTotalsFromNotas();
        payload.quantidadeNotas = Number(payload.quantidadeNotas || payload.notas.length);
        const data = await api("/api/public/solicitacao", { method: "POST", body: JSON.stringify(payload) });
        const voucherLink = data.voucher ? ` • <a href="${data.voucher}" target="_blank" rel="noreferrer">Voucher PDF</a>` : "";
        byId("fornecedorMsg").innerHTML = `Solicitação enviada. Protocolo: <strong>${data.protocolo}</strong>. Horário: <strong>${data.horaAgendada}</strong>. Doca: <strong>${data.doca}</strong>.<br><a href="${data.linkFornecedor}">Consulta da transportadora/fornecedor</a> • <a href="${data.linkMotorista}">Acompanhamento do motorista</a>${voucherLink}<br>Token do motorista: <strong>${data.tokenMotorista}</strong>`;
        e.target.reset();
        stopCameraScan();
        state.nfRows = 1;
        state.nfDrafts = [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }];
        renderNfRows();
        await loadPublicDisponibilidade();
      } catch (err) {
        byId("fornecedorMsg").textContent = err.message;
      }
    });

    byId("consultaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const token = new FormData(e.target).get("token");
        const data = await api(`/api/public/consulta/${token}`);
        byId("consultaMsg").textContent = `Consulta carregada para o protocolo ${data.protocolo}.`;
        byId("consultaResult").innerHTML = renderPublicResult(data, "consulta");
      } catch (err) {
        byId("consultaMsg").textContent = err.message;
        byId("consultaResult").innerHTML = "";
      }
    });

    byId("motoristaConsultaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const token = new FormData(e.target).get("token");
        const data = await api(`/api/public/motorista/${token}`);
        byId("motoristaMsg").textContent = `Acompanhamento carregado para o protocolo ${data.protocolo}.`;
        byId("motoristaResult").innerHTML = renderPublicResult(data, "motorista");
        byId("btnCancelarMotorista")?.addEventListener("click", async () => {
          try {
            await api(`/api/public/motorista/${token}/cancelar`, { method: "POST", body: JSON.stringify({ motivo: "Cancelado pelo motorista via portal" }) });
            byId("motoristaMsg").textContent = "Agendamento cancelado com sucesso.";
            byId("motoristaConsultaForm")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
          } catch (cancelErr) {
            byId("motoristaMsg").textContent = cancelErr.message;
          }
        });
      } catch (err) {
        byId("motoristaMsg").textContent = err.message;
        byId("motoristaResult").innerHTML = "";
      }
    });

    byId("checkinForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await validateCheckin(String(new FormData(e.target).get("token") || ''));
    });

    byId("avaliacaoForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        if (!state.avaliacaoToken) throw new Error("Token de avaliação não informado.");
        const payload = Object.fromEntries(new FormData(e.target).entries());
        const data = await api(`/api/public/avaliacao/${encodeURIComponent(state.avaliacaoToken)}`, { method: 'POST', body: JSON.stringify(payload) });
        byId('avaliacaoMsg').textContent = data.message || 'Avaliação registrada com sucesso.';
        await loadAvaliacaoForm(state.avaliacaoToken);
      } catch (err) {
        byId('avaliacaoMsg').textContent = err.message;
      }
    });
    byId("startCamera")?.addEventListener("click", startCameraScan);
    byId("stopCamera")?.addEventListener("click", stopCameraScan);

    byId("publicDataSelect")?.addEventListener("change", (e) => renderPublicSlots(e.target.value));
    byId('publicPendingFornecedorSearch')?.addEventListener('input', (e) => {
      state.publicPendingSearchTerm = String(e.target.value || '').trim();
      renderPublicPendingFornecedorOptions();
    });

    byId('internalPendingSearch')?.addEventListener('input', (e) => {
      syncInternalSelectionFromDom();
      state.internalPendingSearchTerm = String(e.target.value || '').trim();
      renderPendingNotasInterno();
    });
    byId('btnClearPendingSearch')?.addEventListener('click', () => {
      syncInternalSelectionFromDom();
      state.internalPendingSearchTerm = '';
      const input = byId('internalPendingSearch');
      if (input) input.value = '';
      renderPendingNotasInterno();
    });
    byId('manualNotaForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = byId('manualNotaMsg');
      try {
        const formData = new FormData(e.target);
        const draftNota = {
          numeroNf: String(formData.get('numeroNf') || '').trim(),
          serie: String(formData.get('serie') || '').trim(),
          volumes: Number(formData.get('volumes') || 0),
          peso: Number(formData.get('peso') || 0),
          destino: String(formData.get('destino') || '').trim(),
          empresa: '',
          valorNf: 0,
          observacao: 'NF inserida manualmente - sem pré-lançamento'
        };
        const response = await notifyFiscalForManualNota(draftNota);
        const nota = appendManualNotaToPendingFornecedor(response?.nota || draftNota);
        const ccInfo = String(response?.cc || '').trim();
        const emailSent = !!response?.sent;
        byId('agendamentoMsg').textContent = emailSent
          ? `NF ${nota.numeroNf}${nota.serie ? ` / Série ${nota.serie}` : ''} inserida manualmente, salva no banco e alerta fiscal enviado${ccInfo ? ` com cópia para ${ccInfo}` : ''}.`
          : `NF ${nota.numeroNf}${nota.serie ? ` / Série ${nota.serie}` : ''} inserida manualmente e salva no banco. O alerta ao fiscal não foi enviado: ${response?.reason || 'motivo não informado'}.`;
        if (msg) msg.textContent = 'NF adicionada ao agendamento com sucesso.';
        closeManualNotaModal();
      } catch (err) {
        if (msg) msg.textContent = err.message || 'Não foi possível inserir a NF manualmente.';
      }
    });
    byId('manualNotaModal')?.querySelectorAll('[data-manual-nota-close]').forEach((el) => {
      el.addEventListener('click', () => closeManualNotaModal());
    });
    byId('btnResumoFinanceiro')?.addEventListener('click', async () => {
      try {
        const data = await api('/api/agendamentos/financeiro/resumo-mensal', { method: 'POST', body: JSON.stringify({}) });
        byId('operacaoMsg').textContent = data?.message || 'Resumo financeiro visual enviado com sucesso.';
      } catch (err) {
        byId('operacaoMsg').textContent = err.message || 'Falha ao enviar o resumo financeiro visual.';
      }
    });

    // Bell toggle
    byId('btnNotificacoes')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const drop = byId('notifDropdown');
      if (!drop) return;
      const isHidden = drop.classList.contains('hidden');
      if (isHidden) { renderNotifDropdown(); drop.classList.remove('hidden'); }
      else drop.classList.add('hidden');
    });
    document.addEventListener('click', (e) => {
      const drop = byId('notifDropdown');
      const bell = byId('btnNotificacoes');
      if (drop && bell && !drop.contains(e.target) && !bell.contains(e.target)) drop.classList.add('hidden');
    });

    // ── Multi-seleção e botões da aba Confirmações ─────────────────────────────

    byId('btnDeselecionarTodos')?.addEventListener('click', () => {
      state.confirmacoesSelecionados.clear();
      document.querySelectorAll('#confirmacoes .row-check').forEach((cb) => { cb.checked = false; });
      const chkAll = document.querySelector('#confirmacoes #chkSelectAll');
      if (chkAll) { chkAll.checked = false; chkAll.indeterminate = false; }
      updateConfirmacoesToolbar();
    });

    byId('btnSolicitarReagendamentoLote')?.addEventListener('click', async () => {
      const ids = [...state.confirmacoesSelecionados];
      if (!ids.length) return;
      const ok = await showAppModal({ title: 'Solicitar reagendamento', message: `Solicitar reagendamento para ${ids.length} agendamento(s) selecionado(s)?\n\nOs operadores receberão uma notificação para definir nova data.`, confirmText: 'Sim, solicitar', cancelText: 'Cancelar', tone: 'warning' });
      if (!ok) return;
      try {
        const res = await api('/api/agendamentos/solicitar-reagendamento-lote', { method: 'POST', body: JSON.stringify({ ids }) });
        const sucessos = (res.results || []).filter((r) => r.ok).length;
        const falhas = (res.results || []).filter((r) => !r.ok);
        state.confirmacoesSelecionados.clear();
        document.querySelectorAll('#confirmacoes .row-check').forEach((cb) => { cb.checked = false; });
        const chkAll = document.querySelector('#confirmacoes #chkSelectAll');
        if (chkAll) { chkAll.checked = false; chkAll.indeterminate = false; }
        updateConfirmacoesToolbar();
        byId('operacaoMsg').textContent = `Solicitação enviada para ${sucessos} agendamento(s).${falhas.length ? ` ${falhas.length} falhou.` : ''}`;
      } catch (err) { byId('operacaoMsg').textContent = err.message; }
    });

    byId('btnEncerrarDia')?.addEventListener('click', async () => {
      const input = byId('encerrarDiaInput');
      const data = input?.value;
      if (!data) { byId('operacaoMsg').textContent = 'Selecione uma data para encerrar.'; return; }
      const ok = await showAppModal({ title: 'Encerrar dia', message: `Cancelar todos os agendamentos com status PENDENTE_APROVAÇÃO em ${formatDateBR(data)}?\n\nEsta ação não pode ser desfeita.`, confirmText: 'Encerrar', cancelText: 'Cancelar', tone: 'warning' });
      if (!ok) return;
      try {
        const res = await api('/api/agendamentos/encerrar-dia', { method: 'POST', body: JSON.stringify({ data }) });
        byId('operacaoMsg').textContent = `${res.cancelados} agendamento(s) cancelado(s) em ${formatDateBR(data)}.`;
        await loadAgendamentos();
      } catch (err) { byId('operacaoMsg').textContent = err.message; }
    });

    // ── Fim das novas funções ──────────────────────────────────────────────────

    if (state.token && !isTokenExpired(state.token)) {
      startNotifPolling();
      await fillSelects();
      try { await loadCadastro(); } catch {}
    }

    try {
      await loadPublicDisponibilidade();
      await loadFornecedoresPendentes();
      await loadFornecedoresPendentesInterno();
    } catch (err) {
      const fornecedorMsg = byId("fornecedorMsg");
      if (fornecedorMsg) fornecedorMsg.textContent = err.message;
    }

    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    const token = params.get("token");
    if (view === "checkin" || view === "checkout") {
      if (state.token && !isTokenExpired(state.token)) {
        applyCheckinRouteContext({ autoValidate: false });
      } else {
        showView("login");
      }
    } else if (view === 'avaliacao' && token) {
      showView('avaliacao');
      try {
        await loadAvaliacaoForm(token);
      } catch (err) {
        byId('avaliacaoMsg').textContent = err.message;
      }
    } else if (view === "motorista" && token) {
      showView("motorista");
      const input = byId("motoristaConsultaForm")?.querySelector('input[name="token"]');
      if (input) input.value = token;
      byId("motoristaConsultaForm")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else if (view === "consulta-nf") {
      showView(state.token && !isTokenExpired(state.token) ? "consulta-nf" : "login");
    } else if ((view === "consulta" || view === "fornecedor") && token) {
      showView("consulta");
      const input = byId("consultaForm")?.querySelector('input[name="token"]');
      if (input) input.value = token;
      byId("consultaForm")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else if (view === "consulta") {
      showView("consulta");
    } else if (view === "fornecedor") {
      showView("fornecedor");
    } else if (!document.querySelector('.view.active')) {
      showView(state.token && !isTokenExpired(state.token) ? firstAllowedPrivateView() : 'public-home');
    }
  });
})();
