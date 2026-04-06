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
    docaOptions: []
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
    return `<div class="nf-series-list">${notas.slice(0, 3).map((nota) => {
      const numero = `NF ${String(nota?.numeroNf || '-').trim() || '-'}`;
      const serie = `Série ${String(nota?.serie || '-').trim() || '-'}`;
      return `<span class="nf-series-item">${escapeHtml(`${numero} • ${serie}`)}</span>`;
    }).join('')}${notas.length > 3 ? `<span class="nf-series-item">${escapeHtml(`+${notas.length - 3} NF`)}</span>` : ''}</div>`;
  }

  function statusLabel(status) {
    return String(status || "").replaceAll("_", " ");
  }

  function renderStatusBadge(status, semaforo) {
    return `<span class="badge ${semaforoClass(semaforo || status)}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function renderNotasTable(notas) {
    if (!Array.isArray(notas) || !notas.length) return '<p class="hint">Sem notas fiscais cadastradas.</p>';
    return `<table class="table"><thead><tr><th>Número NF</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas.map((nota) => `<tr><td>${escapeHtml(nota.numeroNf || "-")}</td><td>${escapeHtml(nota.serie || "-")}</td><td>${escapeHtml(nota.chaveAcesso || "-")}</td><td>${escapeHtml(formatDecimalBR(nota.volumes ?? 0, 3))}</td></tr>`).join("")}</tbody></table>`;
  }

  function normalizePendingFornecedor(item = {}) {
    const notas = Array.isArray(item.notasFiscais) ? item.notasFiscais : Array.isArray(item.notas) ? item.notas : [];
    return {
      ...item,
      notas,
      notasFiscais: notas,
      quantidadeNotas: Number(item.quantidadeNotas ?? notas.length ?? 0),
      quantidadeVolumes: Number(item.quantidadeVolumes ?? notas.reduce((acc, nota) => acc + Number(nota?.volumes || 0), 0)),
      pesoTotalKg: Number(item.pesoTotalKg ?? notas.reduce((acc, nota) => acc + Number(nota?.peso || 0), 0)),
      valorTotalNf: Number(item.valorTotalNf ?? notas.reduce((acc, nota) => acc + Number(nota?.valorNf || 0), 0))
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

  function logout() {
    localStorage.removeItem("token");
    state.token = "";
    updateNav();
    showView("public-home");
  }

  function updateNav() {
    const logged = !!state.token && !isTokenExpired(state.token);
    byId("publicNav")?.classList.toggle("hidden", logged);
    byId("privateNav")?.classList.toggle("hidden", !logged);
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
    if (!res.ok) throw new Error(data?.message || data || "Erro na requisição");
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
    return (state.internalSelectedNotas || []).map((nota) => ({
      numeroNf: String(nota?.numeroNf || '').trim(),
      serie: String(nota?.serie || '').trim(),
      chaveAcesso: String(nota?.chaveAcesso || '').trim(),
      volumes: Number(nota?.volumes || 0),
      peso: Number(nota?.peso || 0),
      valorNf: Number(nota?.valorNf || 0),
      observacao: String(nota?.observacao || '').trim()
    }));
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

  function renderPendingNotasInterno() {
    const wrap = byId('internalPendingNotas');
    if (!wrap) return;
    const notas = Array.isArray(state.internalPendingFornecedor?.notas) ? state.internalPendingFornecedor.notas : Array.isArray(state.internalPendingFornecedor?.notasFiscais) ? state.internalPendingFornecedor.notasFiscais : [];
    if (!notas.length) {
      wrap.innerHTML = '<div class="warning-box">Selecione um fornecedor pendente para carregar as NF disponíveis.</div>';
      state.internalSelectedNotas = [];
      updateInternalTotals();
      return;
    }

    wrap.innerHTML = `<div class="pending-notas-toolbar"><button type="button" class="btn-secondary" id="btnSelectAllPendingNotas">Selecionar todos</button></div><div class="pending-notas-grid">${notas.map((nota, idx) => `
      <div class="pending-nota-item">
        <label class="pending-nota-card">
          <div class="pending-nota-check">
            <input type="checkbox" data-internal-nf="${idx}" checked />
            <span>${escapeHtml(`NF ${nota.numeroNf || '-'} • Série ${nota.serie || '-'}`)}</span>
          </div>
          <div class="pending-nota-fields">
            <div class="pending-nota-field">
              <span class="pending-nota-title">Volumes</span>
              <strong>${escapeHtml(formatDecimalBR(nota.volumes || 0, 3))}</strong>
            </div>
            <div class="pending-nota-field">
              <span class="pending-nota-title">Peso</span>
              <strong>${escapeHtml(formatDecimalBR(nota.peso || 0, 3))} kg</strong>
            </div>
            <div class="pending-nota-field pending-nota-field-full">
              <span class="pending-nota-title">Valor da nota</span>
              <strong>${escapeHtml(Number(nota.valorNf || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</strong>
            </div>
          </div>
        </label>
      </div>`).join('')}</div>`;

    const sync = () => {
      state.internalSelectedNotas = notas.filter((_nota, index) => wrap.querySelector(`[data-internal-nf="${index}"]`)?.checked);
      updateInternalTotals();
    };

    wrap.querySelectorAll('[data-internal-nf]').forEach((el) => el.addEventListener('change', sync));
    wrap.querySelector('#btnSelectAllPendingNotas')?.addEventListener('click', () => {
      wrap.querySelectorAll('[data-internal-nf]').forEach((el) => { el.checked = true; });
      sync();
    });

    state.internalSelectedNotas = [...notas];
    updateInternalTotals();
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
      state.pendingFornecedores = Array.isArray(items) ? items.map(normalizePendingFornecedor) : [];
      const select = byId('internalFornecedorPendenteSelect');
      if (!select) return;
      select.innerHTML = `<option value="">Selecione o fornecedor pendente</option>` + state.pendingFornecedores.map((item) => `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.fornecedor || item.nome || '-')} (${escapeHtml(item.quantidadeNotas ?? 0)} NF)</option>`).join('');
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
            <th>Doca</th>
            <th>Janela</th>
            <th>Data</th>
            <th>Hora</th>
            <th>NF / Série</th>
            <th>Volumes</th>
            <th>Peso kg</th>
            <th>Valor total</th>
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
              <td>${escapeHtml(currentDocaLabel(item))}</td>
              <td>${escapeHtml(item.janela?.codigo || item.janela || '')}</td>
              <td>${escapeHtml(formatDateBR(item.dataAgendada || '') || '')}</td>
              <td>${escapeHtml(formatHour(item.horaAgendada || '') || '')}</td>
              <td class="nf-series-cell">${renderNotaSerieList(item)}</td>
              <td>${escapeHtml(formatDecimalBR(item.quantidadeVolumes || 0, 3))}</td>
              <td>${escapeHtml(formatDecimalBR(item.pesoTotalKg || 0, 3))}</td>
              <td>${escapeHtml(Number(item.valorTotalNf || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</td>
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
    if (kpis) {
      kpis.innerHTML = "";
      const hiddenKpis = new Set(['documentos', 'volumes', 'origem']);
      Object.entries(data.kpis || {})
        .filter(([k]) => !hiddenKpis.has(String(k || '').toLowerCase()))
        .forEach(([k, v]) => {
          const div = document.createElement("div");
          div.className = "kpi";
          const key = String(k || '').toLowerCase();
          let formatted = v;
          if (key.includes('valor')) formatted = Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          else if (key.includes('peso') || key.includes('volume')) formatted = formatDecimalBR(v || 0, 3);
          else if (typeof v === 'number') formatted = formatIntegerBR(v);
          div.innerHTML = `<strong>${escapeHtml(k)}</strong><span>${escapeHtml(formatted)}</span>`;
          kpis.appendChild(div);
        });
    }
    renderOperationalTable(data.agendamentos || [], { targetId: 'dashboardTable', includeActions: true });
  }

  function semaforoClass(v) {
    const s = String(v || "").toLowerCase();
    if (s.includes("verde")) return "verde";
    if (s.includes("amarelo")) return "amarelo";
    return "vermelho";
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
        <span class="badge ${semaforoClass(d.semaforo)}">${escapeHtml(d.semaforo)}</span>
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
      await fn();
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
        if (modo === 'checkin' && /divergente/i.test(String(err.message || ''))) {
          const liberar = window.confirm(`${err.message}

Deseja liberar manualmente a descarga deste veículo?`);
          if (!liberar) throw err;
          data = await api(endpoint, { method: "POST", body: JSON.stringify({ overrideDateMismatch: true }) });
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

  document.addEventListener("DOMContentLoaded", async () => {
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
    byId("btnAprovar")?.addEventListener("click", async () => handleOp(() => postStatus("aprovar", { janelaId: byId("internalJanelaSelect")?.value }), "Agendamento aprovado."));
    byId("btnReprovar")?.addEventListener("click", async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado."));
    byId("btnReagendar")?.addEventListener("click", async () => handleOp(() => postStatus("reagendar", { dataAgendada: new Date().toISOString().slice(0, 10), horaAgendada: "10:00", janelaId: byId("internalJanelaSelect")?.value }), "Agendamento reagendado."));
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
    } else if (view === "motorista" && token) {
      showView("motorista");
      const input = byId("motoristaConsultaForm")?.querySelector('input[name="token"]');
      if (input) input.value = token;
      byId("motoristaConsultaForm")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
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
