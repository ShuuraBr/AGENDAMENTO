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
    internalSelectedNotas: [],
    docaOptions: [],
    currentUser: null,
    auditoria: [],
    avaliacaoToken: "",
    missingRelatorioAlertKeys: new Set()
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
        { name: "telefone", label: "Telefone", type: "text" }
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
        { name: "senha", label: "Senha", type: "password" }
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
    const candidates = [nota?.destino, nota?.destinoRelatorio, nota?.empresa, nota?.empresaRelatorio]
      .map((value) => resolveStoreKey(value) || normalizeCompanyKey(value))
      .filter(Boolean);
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
    return String(status || "").replaceAll("_", " ");
  }

  function statusTone(status = "", semaforo = "") {
    const statusMap = {
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
      tooltipVencimento: String(item.tooltipVencimento || '').trim()
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

  function normalizeOperationToken(rawValue) {
    const raw = String(rawValue || "").trim();
    if (!raw) return "";
    try {
      const url = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : new URL(raw, window.location.origin);
      const token = url.searchParams.get("token");
      if (token) return token;
    } catch {}
    const match = raw.match(/(?:^|[?&])token=([^&#]+)/i);
    if (match?.[1]) {
      try { return decodeURIComponent(match[1]); } catch { return match[1]; }
    }
    return raw;
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
      perfil: payload.perfil || ""
    };
    return state.currentUser;
  }

  function currentProfile() {
    return String(state.currentUser?.perfil || syncCurrentUserFromToken()?.perfil || "").toUpperCase();
  }

  function isAdmin() {
    return currentProfile() === "ADMIN";
  }

  function applyRoleAccess() {
    const usersTab = document.querySelector('.cad-tab[data-tipo="usuarios"]');
    if (usersTab) usersTab.classList.toggle('hidden', !isAdmin());
    if (!isAdmin() && state.cadastroTipo === 'usuarios') {
      state.cadastroTipo = 'fornecedores';
      setActiveButton('.cad-tab', document.querySelector('.cad-tab[data-tipo="fornecedores"]'));
      renderCadastroForm();
      loadCadastro().catch(() => {});
    }
  }

  function logout() {
    localStorage.removeItem("token");
    state.token = "";
    state.currentUser = null;
    updateNav();
    showView("public-home");
  }

  function updateNav() {
    const logged = !!state.token && !isTokenExpired(state.token);
    if (logged) syncCurrentUserFromToken();
    byId("publicNav")?.classList.toggle("hidden", logged);
    byId("privateNav")?.classList.toggle("hidden", !logged);
    applyRoleAccess();
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
      const err = new Error(data?.message || data || "Erro na requisição");
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
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    byId(id)?.classList.add("active");
    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === id);
    });
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

  async function loadFornecedoresPendentes() {
    try {
      const items = await api('/api/public/fornecedores-pendentes');
      state.pendingFornecedores = Array.isArray(items) ? items.map(normalizePendingFornecedor) : [];
      const select = byId('fornecedorPendenteSelect');
      if (!select) return;
      select.innerHTML = `<option value="">Selecionar manualmente</option>` + state.pendingFornecedores.map((item) => `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.fornecedor || item.nome || '-')} (${escapeHtml(item.quantidadeNotas ?? 0)} NF)</option>`).join('');
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
              const normalizedToken = normalizeOperationToken(codes[0].rawValue);
              if (tokenInput) tokenInput.value = normalizedToken;
              await validateCheckin(normalizedToken);
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
    const horarios = (dia?.horarios || []).filter((slot) => slot.disponivel > 0);

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

  function buildNotasFromLines(text) {
    return String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => ({ numeroNf: line, serie: '', chaveAcesso: '', volumes: 0, peso: 0, valorNf: 0, observacao: '' }));
  }

  function selectedInternalNotas() {
    const notas = Array.isArray(state.internalPendingFornecedor?.notas)
      ? state.internalPendingFornecedor.notas
      : Array.isArray(state.internalPendingFornecedor?.notasFiscais)
        ? state.internalPendingFornecedor.notasFiscais
        : [];

    const wrap = byId('internalPendingNotas');
    const selectedFromDom = wrap
      ? notas
          .filter((_nota, index) => wrap.querySelector(`[data-internal-nf="${index}"]`)?.checked)
          .map((nota) => ({ ...nota }))
      : [];

    const source = selectedFromDom.length || wrap ? selectedFromDom : (state.internalSelectedNotas || []);
    const unique = [];
    const seen = new Set();

    for (const nota of source) {
      const normalized = {
        rowHash: String(nota?.rowHash || '').trim(),
        numeroNf: String(nota?.numeroNf || '').trim(),
        serie: String(nota?.serie || '').trim(),
        empresa: String(nota?.empresa || '').trim(),
        destino: String(nota?.destino || '').trim(),
        dataEntrada: String(nota?.dataEntrada || '').trim(),
        dataEntradaBr: String(nota?.dataEntradaBr || '').trim(),
        entrada: String(nota?.entrada || '').trim(),
        dataPrimeiroVencimento: String(nota?.dataPrimeiroVencimento || '').trim(),
        dataPrimeiroVencimentoBr: String(nota?.dataPrimeiroVencimentoBr || '').trim(),
        diasParaPrimeiroVencimento: nota?.diasParaPrimeiroVencimento == null ? null : Number(nota.diasParaPrimeiroVencimento),
        alertaVencimentoProximo: !!nota?.alertaVencimentoProximo,
        tooltipVencimento: String(nota?.tooltipVencimento || '').trim(),
        chaveAcesso: String(nota?.chaveAcesso || '').trim(),
        volumes: Number(nota?.volumes || 0),
        peso: Number(nota?.peso || 0),
        valorNf: Number(nota?.valorNf || 0),
        observacao: String(nota?.observacao || '').trim()
      };
      const key = normalized.rowHash || `${normalized.numeroNf}::${normalized.serie}::${normalized.valorNf}::${normalized.peso}::${normalized.volumes}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(normalized);
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
    const boxes = [...(wrap?.querySelectorAll('[data-internal-nf]') || [])];
    const button = wrap?.querySelector('#btnSelectAllPendingNotas');
    if (!button) return;
    const allChecked = boxes.length > 0 && boxes.every((el) => el.checked);
    button.textContent = allChecked ? 'Desmarcar todos' : 'Selecionar todos';
  }

  function renderPendingNotasInterno() {
    const wrap = byId('internalPendingNotas');
    if (!wrap) return;
    const sourceNotas = Array.isArray(state.internalPendingFornecedor?.notas) ? state.internalPendingFornecedor.notas : Array.isArray(state.internalPendingFornecedor?.notasFiscais) ? state.internalPendingFornecedor.notasFiscais : [];
    const notas = [...sourceNotas].sort((a, b) => {
      if (!!a.alertaVencimentoProximo !== !!b.alertaVencimentoProximo) return a.alertaVencimentoProximo ? -1 : 1;
      const dueA = a.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(a.diasParaPrimeiroVencimento);
      const dueB = b.diasParaPrimeiroVencimento == null ? Number.POSITIVE_INFINITY : Number(b.diasParaPrimeiroVencimento);
      if (dueA !== dueB) return dueA - dueB;
      return String(a.numeroNf || '').localeCompare(String(b.numeroNf || ''), 'pt-BR');
    });
    if (!notas.length) {
      wrap.innerHTML = '<div class="warning-box">Selecione um fornecedor pendente para carregar as NF disponíveis.</div>';
      state.internalSelectedNotas = [];
      updateInternalTotals();
      return;
    }

    const groups = [
      { title: 'Notas com 1º vencimento próximo', items: notas.filter((nota) => nota.alertaVencimentoProximo), highlight: true },
      { title: 'Demais notas pendentes', items: notas.filter((nota) => !nota.alertaVencimentoProximo), highlight: false }
    ].filter((group) => group.items.length);

    wrap.innerHTML = `<div class="pending-notas-toolbar"><button type="button" class="btn-secondary" id="btnSelectAllPendingNotas">Selecionar todos</button></div>${groups.map((group) => `<div class="pending-notas-group${group.highlight ? ' pending-notas-group-highlight' : ''}"><h4>${escapeHtml(group.title)} <span>${escapeHtml(formatIntegerBR(group.items.length))} NF</span></h4><div class="pending-notas-grid">${group.items.map((nota, idx) => {
      const originalIndex = notas.findIndex((candidate) => candidate === nota);
      const dueClass = nota.alertaVencimentoProximo ? ' pending-nota-item-warning' : '';
      const tooltip = nota.tooltipVencimento || '';
      const label = `NF ${nota.numeroNf || '-'} • Série ${nota.serie || '-'}`;
      const dueBadge = nota.alertaVencimentoProximo ? `<span class="pending-note-due-badge" title="${escapeHtml(tooltip)}">Venc. próximo${nota.dataPrimeiroVencimentoBr ? ` • ${escapeHtml(nota.dataPrimeiroVencimentoBr)}` : ''}</span>` : '';
      const empresa = nota.empresa ? `<span class="pending-note-company">${escapeHtml(nota.empresa)}</span>` : '';
      const destinoLogo = renderStoreLogo(nota.destino || nota.empresa, { showEmpty: false });
      const dataEntrada = nota.dataEntradaBr || nota.dataEntrada || '-';
      return `<div class="pending-nota-item${dueClass}" title="${escapeHtml(tooltip)}"><label class="pending-nota-card"><div class="pending-nota-check"><input type="checkbox" data-internal-nf="${originalIndex}" /><span>${escapeHtml(label)}</span><div class="pending-note-tags">${empresa}${destinoLogo}${dueBadge}</div></div><div class="pending-nota-meta"><span><strong>Entrada:</strong> ${escapeHtml(dataEntrada)}</span><span><strong>Peso:</strong> ${escapeHtml(formatDecimalBR(nota.peso || 0, 3))} kg</span><span><strong>Volumes:</strong> ${escapeHtml(formatDecimalBR(nota.volumes || 0, 3))}</span></div></label></div>`;
    }).join('')}</div></div>`).join('')}`;

    const sync = () => {
      state.internalSelectedNotas = notas
        .filter((_nota, index) => wrap.querySelector(`[data-internal-nf="${index}"]`)?.checked)
        .map((nota) => ({ ...nota }));
      updateInternalTotals();
      syncPendingNotasSelectionUI(wrap);
    };

    wrap.querySelectorAll('[data-internal-nf]').forEach((el) => el.addEventListener('change', sync));
    wrap.querySelector('#btnSelectAllPendingNotas')?.addEventListener('click', () => {
      const checkboxes = [...wrap.querySelectorAll('[data-internal-nf]')];
      const allChecked = checkboxes.length > 0 && checkboxes.every((el) => el.checked);
      checkboxes.forEach((el) => { el.checked = !allChecked; });
      sync();
    });

    state.internalSelectedNotas = [];
    updateInternalTotals();
    syncPendingNotasSelectionUI(wrap);
  }


  function applyFornecedorPendenteInterno(item) {
    state.internalPendingFornecedor = item || null;
    const fornecedorField = byId('internalFornecedorNome');
    if (fornecedorField) fornecedorField.value = String(item?.fornecedor || item?.nome || '').trim();
    renderPendingNotasInterno();
  }

  async function loadFornecedoresPendentesInterno() {
    try {
      const items = await api('/api/public/fornecedores-pendentes');
      state.pendingFornecedores = sortPendingFornecedores(Array.isArray(items) ? items.map(normalizePendingFornecedor) : []);
      const select = byId('internalFornecedorPendenteSelect');
      if (!select) return;
      select.innerHTML = `<option value="">Selecione o fornecedor pendente</option>` + state.pendingFornecedores.map((item) => {
        return `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.fornecedor || item.nome || '-')} (${escapeHtml(item.quantidadeNotas ?? 0)} NF)</option>`;
      }).join('');
      select.onchange = () => {
        if (!select.value) {
          state.internalPendingFornecedor = null;
          state.internalSelectedNotas = [];
          const fornecedorField = byId('internalFornecedorNome');
          if (fornecedorField) fornecedorField.value = '';
          renderPendingNotasInterno();
          return;
        }
        const selected = getPendingFornecedorById(select.value);
        if (selected) applyFornecedorPendenteInterno(selected);
      };
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
    if (!state.token || isTokenExpired(state.token)) return;
    try {
      const items = await api('/api/agendamentos');
      populateSelectOptions(byId('fStatus'), items.map((item) => item.status), 'Status');
      populateSelectOptions(byId('fFornecedor'), items.map((item) => item.fornecedor), 'Fornecedor');
      populateSelectOptions(byId('fTransportadora'), items.map((item) => item.transportadora), 'Transportadora');
      populateSelectOptions(byId('fMotorista'), items.map((item) => item.motorista), 'Motorista');
      populateSelectOptions(byId('fPlaca'), items.map((item) => item.placa), 'Placa');
    } catch {}
  }

  function renderOperationalTable(items, { targetId, includeActions = false } = {}) {
    const wrap = byId(targetId);
    if (!wrap) return;
    if (!Array.isArray(items) || !items.length) {
      wrap.innerHTML = '<p>Nenhum registro.</p>';
      return;
    }
    wrap.innerHTML = `
      <table class="table operational-table">
        <thead>
          <tr>
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
            ${includeActions ? '<th>Ações</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr>
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
              ${includeActions ? `<td>
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

    if (includeActions) {
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
    try {
      const janelas = await api("/api/cadastros/janelas");
      const janelaOptions = janelas.map((j) => `<option value="${j.id}">${escapeHtml(j.codigo)}</option>`).join("");
      const janelaSelect = byId("internalJanelaSelect");
      if (janelaSelect) janelaSelect.innerHTML = janelaOptions;
      await Promise.allSettled([loadDocaOptions(), loadFilterOptions()]);
    } catch {}
  }

  async function loadDashboard() {
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k, v]) => { if (v) params.set(k, v); });
    const data = await api(`/api/dashboard/operacional?${params.toString()}`);
    const kpis = byId("kpis");
    const hiddenKpis = new Set(['documentos', 'volumes', 'origem', 'valorTotal']);
    const labels = {
      total: 'Total',
      pendentes: 'Pendentes',
      aprovados: 'Aprovados',
      chegou: 'Chegou',
      emDescarga: 'Em descarga',
      finalizados: 'Finalizados',
      cancelados: 'Cancelados',
      noShow: 'No-show',
      pesoKg: 'Peso (kg)'
    };
    if (kpis) {
      kpis.className = 'grid kpi-grid';
      kpis.innerHTML = '';
      Object.entries(data.kpis || {}).forEach(([k, v]) => {
        if (hiddenKpis.has(String(k || ''))) return;
        const div = document.createElement('div');
        div.className = 'kpi';
        const key = String(k || '');
        let formatted = v;
        if (key.includes('valor')) formatted = Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        else if (key.toLowerCase().includes('peso')) formatted = formatDecimalBR(v || 0, 3);
        else if (typeof v === 'number') formatted = formatIntegerBR(v);
        const length = String(formatted ?? '').length;
        const valueClass = length > 16 ? 'kpi-value kpi-value-compact' : length > 11 ? 'kpi-value kpi-value-tight' : 'kpi-value';
        const label = labels[key] || statusLabel(key);
        div.innerHTML = `<span class="kpi-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span><span class="${valueClass}" title="${escapeHtml(formatted)}">${escapeHtml(formatted)}</span>`;
        kpis.appendChild(div);
      });
    }
    renderOperationalTable(data.agendamentos || [], { targetId: 'dashboardTable', includeActions: true });
    await maybeShowMissingRelatorioAlerts(data.agendamentos || []);
  }

  function formatAuditDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR');
  }

  function renderAuditoria(_items = []) {
    return;
  }

  async function loadAuditoria() {
    return [];
  }

  async function loadDocas() {
    const date = byId("docaData")?.value || "";
    const data = await api(`/api/dashboard/docas${date ? `?dataAgendada=${encodeURIComponent(date)}` : ""}`);
    const wrap = byId("docaPainel");
    if (!wrap) return;

    wrap.innerHTML = data.map((d) => `
      <div class="doca-card sem-${String(d.semaforo).toLowerCase()}">
        <h3>${escapeHtml(d.codigo)}</h3>
        <p>${escapeHtml(d.descricao || "")}</p>
        <p><strong>Ocupação:</strong> ${escapeHtml(d.ocupacaoAtual)}</p>
        <span class="badge ${statusTone(d.ocupacaoAtual, d.semaforo)}">${escapeHtml(d.semaforo)}</span>
        <div class="mt12">
          <strong>Fila (${d.fila.length})</strong>
          ${d.fila.length ? d.fila.map((f) => {
            const needsDoca = d.codigo === "A DEFINIR" && ["CHEGOU", "APROVADO", "PENDENTE_APROVACAO"].includes(f.status);
            return `
              <div class="fila-item">
                <div><strong>${escapeHtml(f.protocolo)}</strong> • ${escapeHtml(f.motorista)}</div>
                <div>${escapeHtml(f.placa)} • ${escapeHtml(formatHour(f.horaAgendada))} • ${escapeHtml(f.status)}</div>
                ${needsDoca ? `<div class="warning-box">Selecione a doca para este agendamento.</div><div class="row gap8 wrap mt12"><select data-doca-painel-select="${escapeHtml(f.id)}" class="dock-select">${docaSelectOptions(f.doca?.id || f.docaId || '')}</select><button type="button" data-doca-painel-save="${escapeHtml(f.id)}">Definir doca</button></div>` : ""}
              </div>
            `;
          }).join("") : "<div class='fila-item'>Sem fila</div>"}
        </div>
      </div>
    `).join("");

    wrap.querySelectorAll('[data-doca-painel-save]').forEach((btn) => btn.addEventListener('click', async () => {
      const agendamentoId = btn.dataset.docaPainelSave;
      const select = wrap.querySelector(`[data-doca-painel-select="${agendamentoId}"]`);
      const docaId = select?.value || '';
      if (!docaId) {
        byId('operacaoMsg').textContent = 'Selecione a doca antes de confirmar.';
        return;
      }
      try {
        await api(`/api/agendamentos/${agendamentoId}/definir-doca`, { method: 'POST', body: JSON.stringify({ docaId }) });
        byId('operacaoMsg').textContent = 'Doca definida com sucesso.';
        await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas(), loadFilterOptions()]);
      } catch (err) {
        byId('operacaoMsg').textContent = err.message;
      }
    }));
  }

  function normalizeValueByField(field, value) {
    if (field.type === "number") return value === "" ? 0 : Number(value);
    return value;
  }

  function buildField(field, value = "") {
    const wrapperClass = field.full ? "form-group form-group-full" : "form-group";
    const requiredAttr = field.required ? "required" : "";
    const safeValue = value ?? "";

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
  }

  function getCadastroPayload() {
    const config = CADASTRO_CONFIG[state.cadastroTipo];
    const data = Object.fromEntries(new FormData(byId("cadastroForm")).entries());
    const payload = {};
    config.fields.forEach((field) => {
      payload[field.name] = normalizeValueByField(field, data[field.name] ?? "");
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
    if (state.cadastroTipo === "usuarios" && !isAdmin()) {
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
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k, v]) => { if (v) params.set(k, v); });
    const items = await api(`/api/agendamentos?${params.toString()}`);
    renderOperationalTable(items || [], { targetId: 'agendamentosList', includeActions: false });
    await maybeShowMissingRelatorioAlerts(items || []);
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
    for (const item of Array.isArray(items) ? items : []) {
      const missing = item?.monitoramentoNf?.notasAusentesNoRelatorio || [];
      if (!missing.length) continue;
      const key = `${item.id}:${missing.map((nota) => `${nota.numeroNf || ''}-${nota.serie || ''}`).join('|')}`;
      if (state.missingRelatorioAlertKeys.has(key)) continue;
      state.missingRelatorioAlertKeys.add(key);
      await showAppModal({
        title: 'NF não disponível no relatório',
        message: [
          `O agendamento ${item.protocolo || item.id || ''} possui nota(s) que não constam mais no relatório terceirizado atual.`,
          '',
          ...missing.map((nota) => `NF ${nota.numeroNf || '-'} / Série ${nota.serie || '-'}`),
          '',
          'Verifique a situação da nota antes de prosseguir com a operação.'
        ].join('\n'),
        confirmText: 'Entendi',
        tone: 'danger'
      });
    }
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
          ${agendamentos.length ? `<table class="table"><thead><tr><th>ID</th><th>Protocolo</th><th>Status</th><th>Usuário</th><th>Fornecedor</th><th>Data agendada</th><th>Faltam</th><th>Hora</th><th>Data entrada</th><th>1º vencimento</th></tr></thead><tbody>${agendamentos.map((item) => {
            const notas = Array.isArray(item.notasFiscais) ? item.notasFiscais : [];
            const notaConsultada = (targetDigits ? notas.find((nota) => normalizeDigitsValue(nota?.numeroNf || '').includes(targetDigits)) : null) || notas[0] || {};
            const faltam = item.diasParaAgendamento == null ? formatRemainingDaysLabel(item.dataAgendada || '') : (Number(item.diasParaAgendamento) === 0 ? 'Hoje' : Number(item.diasParaAgendamento) > 0 ? `${Number(item.diasParaAgendamento)} dia(s)` : `${Math.abs(Number(item.diasParaAgendamento))} dia(s) atrás`);
            return `<tr><td>${escapeHtml(item.id || '-')}</td><td>${escapeHtml(item.protocolo || '-')}</td><td>${renderStatusBadge(item.status, item.semaforo || '')}</td><td>${escapeHtml(item.usuarioAgendamento || '-')}</td><td>${escapeHtml(item.fornecedor || '-')}</td><td>${escapeHtml(formatDateBR(item.dataAgendada || ''))}</td><td>${escapeHtml(faltam)}</td><td>${escapeHtml(formatHour(item.horaAgendada || ''))}</td><td>${escapeHtml(notaConsultada?.dataEntradaBr || notaConsultada?.dataEntrada || '-')}</td><td>${escapeHtml(notaConsultada?.dataPrimeiroVencimentoBr || notaConsultada?.dataPrimeiroVencimento || '-')}</td></tr>`;
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
      const normalizedToken = normalizeOperationToken(token);
      const tokenInput = byId('checkinForm')?.querySelector('[name="token"]');
      if (tokenInput) tokenInput.value = normalizedToken;
      if (!normalizedToken) throw new Error('Informe o token da operação.');
      const modo = byId("checkinForm")?.querySelector("[name=modo]")?.value || "checkin";
      const endpoint = modo === "checkout" ? `/api/public/checkout/${encodeURIComponent(normalizedToken)}` : `/api/public/checkin/${encodeURIComponent(normalizedToken)}`;
      let data;
      try {
        data = await api(endpoint, { method: "POST", body: JSON.stringify({}) });
      } catch (err) {
        const message = String(err.message || '');
        if (modo === 'checkin' && (/fora da janela/i.test(message) || /divergente/i.test(message))) {
          const liberar = window.confirm(`${message}

Deseja liberar manualmente a descarga deste veículo?`);
          if (!liberar) throw err;
          data = await api(endpoint, { method: "POST", body: JSON.stringify({ overrideManualAuthorization: true, overrideDateMismatch: true, overrideTimeMismatch: true }) });
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
      `;
    }
    if (form) {
      form.reset();
      Array.from(form.elements).forEach((el) => { if (el?.tagName) el.disabled = !!data.respondeu; });
    }
    if (msg && data.respondeu) msg.textContent = 'Esta avaliação já foi respondida. Obrigado pelo retorno.';
  }

  document.addEventListener("DOMContentLoaded", async () => {
    syncCurrentUserFromToken();
    updateNav();
    renderNfRows();
    renderCadastroForm();
    renderPendingNotasInterno();
    byId("loginForm")?.reset();
    applyInputMasks(document);
    const internalDateInput = byId("agendamentoForm")?.querySelector('[name="dataAgendada"]');
    if (internalDateInput && !internalDateInput.value) internalDateInput.value = new Date().toISOString().slice(0, 10);

    document.querySelectorAll("[data-view]").forEach((btn) => {
      btn.setAttribute("type", "button");
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        showView(btn.dataset.view);
      });
    });

    byId("btnLogout")?.addEventListener("click", logout);

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
        state.token = data.token;
        localStorage.setItem("token", data.token);
        state.currentUser = data.user || null;
        syncCurrentUserFromToken();
        updateNav();
        await fillSelects();
        if (!applyCheckinRouteContext({ autoValidate: true })) {
          showView("dashboard");
          await loadDashboard();
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
        if (btn.dataset.tipo === "usuarios" && !isAdmin()) {
          byId("cadastroMsg").textContent = "Apenas administradores podem acessar o cadastro de usuários.";
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
    byId("saveCadastro")?.addEventListener("click", async () => { try { await saveCadastro(); } catch (err) { byId("cadastroMsg").textContent = err.message; } });
    byId("loadCadastro")?.addEventListener("click", async () => { try { await loadCadastro(); } catch (err) { byId("cadastroMsg").textContent = err.message; } });

    byId("agendamentoForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(e.target).entries());
        payload.dataAgendada = normalizeDateToIso(payload.dataAgendada);
        payload.horaAgendada = formatHour(payload.horaAgendada);
        payload.cpfMotorista = String(payload.cpfMotorista || '').replace(/\D/g, '');
        payload.telefoneMotorista = String(payload.telefoneMotorista || '').replace(/\D/g, '');
        payload.notasFiscais = selectedInternalNotas();
        payload.quantidadeNotas = Number(payload.notasFiscais.length || 0);
        payload.quantidadeVolumes = parseNumberBR(byId('internalQuantidadeVolumes')?.value || 0);
        payload.pesoTotalKg = parseNumberBR(byId('internalPesoTotalKg')?.value || 0);
        payload.valorTotalNf = parseNumberBR(byId('internalValorTotalNf')?.value || 0);
        if (!payload.fornecedorPendenteInterno) throw new Error('Selecione o fornecedor pendente.');
        if (!payload.fornecedor) throw new Error('Fornecedor pendente inválido.');
        if (!payload.notasFiscais.length) throw new Error('Selecione ao menos uma NF pendente para o agendamento.');
        delete payload.fornecedorPendenteInterno;
        const awareness = await confirmAwarenessForPayload(payload);
        if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
        if (awareness.confirmed) payload.confirmarCienciaVencimento = true;
        const data = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(payload) });
        byId("agendamentoId").value = data.id || "";
        byId("agendamentoMsg").textContent = `Agendamento criado: ${data.protocolo} | ID: ${data.id}`;
        e.target.reset();
        state.internalPendingFornecedor = null;
        state.internalSelectedNotas = [];
        const fornecedorField = byId('internalFornecedorNome');
        if (fornecedorField) fornecedorField.value = '';
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
      const body = { janelaId: byId("internalJanelaSelect")?.value };
      const awareness = await confirmAwarenessForExistingAgendamento(currentId(), body);
      if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
      if (awareness.confirmed) body.confirmarCienciaVencimento = true;
      return postStatus("aprovar", body);
    }, "Agendamento aprovado."));
    byId("btnReprovar")?.addEventListener("click", async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado."));
    byId("btnReagendar")?.addEventListener("click", async () => handleOp(async () => {
      const body = { dataAgendada: new Date().toISOString().slice(0, 10), horaAgendada: "10:00", janelaId: byId("internalJanelaSelect")?.value };
      const awareness = await confirmAwarenessForExistingAgendamento(currentId(), body);
      if (awareness.analysis?.requiresAwareness && !awareness.confirmed) return;
      if (awareness.confirmed) body.confirmarCienciaVencimento = true;
      return postStatus("reagendar", body);
    }, "Agendamento reagendado."));
    byId("btnCancelar")?.addEventListener("click", async () => handleOp(() => postStatus("cancelar", { motivo: "Cancelado via painel" }), "Agendamento cancelado."));
    byId("btnIniciar")?.addEventListener("click", async () => handleOp(() => postStatus("iniciar"), "Descarga iniciada."));
    byId("btnFinalizar")?.addEventListener("click", async () => handleOp(() => postStatus("finalizar"), "Agendamento finalizado."));
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
        byId("fornecedorMsg").innerHTML = `Solicitação enviada. Protocolo: <strong>${data.protocolo}</strong>. Horário: <strong>${data.horaAgendada}</strong>. Doca: <strong>${data.doca}</strong>.<br><a href="${data.linkFornecedor}">Consulta da transportadora/fornecedor</a> • <a href="${data.linkMotorista}">Acompanhamento do motorista</a> • <a href="${data.voucher}" target="_blank" rel="noreferrer">Voucher PDF</a><br>Token do motorista: <strong>${data.tokenMotorista}</strong>`;
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
      await validateCheckin(normalizeOperationToken(new FormData(e.target).get("token")));
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

    if (state.token && !isTokenExpired(state.token)) {
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
      showView(state.token && !isTokenExpired(state.token) ? "agendamentos" : "login");
    } else if ((view === "consulta" || view === "fornecedor") && token) {
      showView("consulta");
      const input = byId("consultaForm")?.querySelector('input[name="token"]');
      if (input) input.value = token;
      byId("consultaForm")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else if (view === "consulta") {
      showView("consulta");
    } else if (view === "fornecedor") {
      showView("fornecedor");
    }
  });
})();
