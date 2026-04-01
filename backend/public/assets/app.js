(() => {
  const state = {
    token: localStorage.getItem("token") || "",
    cadastroTipo: "fornecedores",
    cadastroEditId: null,
    cadastroCache: [],
    nfRows: 1,
    nfDrafts: [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }],
    disponibilidadePublica: [],
    cameraStream: null,
    barcodeDetector: null,
    scanning: false,
    internalPendingFornecedor: null,
    internalPendingFornecedores: [],
    internalSelectedNotas: []
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

  function statusLabel(status) {
    return String(status || "").replaceAll("_", " ");
  }

  function renderStatusBadge(status, semaforo) {
    return `<span class="badge ${semaforoClass(semaforo || status)}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function renderNotasTable(notas) {
    if (!Array.isArray(notas) || !notas.length) return '<p class="hint">Sem notas fiscais cadastradas.</p>';
    return `<table class="table"><thead><tr><th>Número NF</th><th>Série</th><th>Chave</th><th>Volumes</th></tr></thead><tbody>${notas.map((nota) => `<tr><td>${escapeHtml(nota.numeroNf || "-")}</td><td>${escapeHtml(nota.serie || "-")}</td><td>${escapeHtml(nota.chaveAcesso || "-")}</td><td>${escapeHtml(nota.volumes ?? 0)}</td></tr>`).join("")}</tbody></table>`;
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
            <div><span>Hora</span><strong>${escapeHtml(data.horaAgendada || "-")}</strong></div>
            <div><span>Doca</span><strong>${escapeHtml(data.doca || "A DEFINIR")}</strong></div>
            <div><span>Janela</span><strong>${escapeHtml(data.janela || "-")}</strong></div>
            <div><span>Volumes</span><strong>${escapeHtml(data.quantidadeVolumes ?? 0)}</strong></div>
            <div><span>Notas</span><strong>${escapeHtml(data.quantidadeNotas ?? 0)}</strong></div>
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
    form.querySelector('[name="quantidadeNotas"]').value = totalNotas;
    form.querySelector('[name="quantidadeVolumes"]').value = totalVolumes;
    form.querySelector('[name="pesoTotalKg"]').value = totalPeso.toFixed(3);
    form.querySelector('[name="valorTotalNf"]').value = totalValor.toFixed(2);
  }

  async function loadFornecedoresPendentes() {
    try {
      const items = await api('/api/public/fornecedores-pendentes');
      const select = byId('fornecedorPendenteSelect');
      if (!select) return;
      select.innerHTML = `<option value="">Selecionar manualmente</option>` + (Array.isArray(items) ? items.map((item) => `<option value="${escapeHtml(JSON.stringify(item).replaceAll('"','&quot;'))}">${escapeHtml(item.fornecedor || item.nome || '-')}</option>`).join('') : '');
      select.addEventListener('change', () => {
        if (!select.value) return;
        const data = JSON.parse(select.value);
        const form = byId('fornecedorForm');
        ['fornecedor','transportadora','placa'].forEach((field) => { if (data[field] && form.querySelector(`[name="${field}"]`)) form.querySelector(`[name="${field}"]`).value = data[field]; });
        if (Array.isArray(data.notasFiscais) && data.notasFiscais.length) {
          state.nfRows = data.notasFiscais.length;
          state.nfDrafts = data.notasFiscais.map((n) => ({ numeroNf: n.numeroNf || '', serie: n.serie || '', chaveAcesso: n.chaveAcesso || '', volumes: String(n.volumes || 0), peso: String(n.peso || 0), valorNf: String(n.valorNf || 0), observacao: n.observacao || '' }));
          renderNfRows();
          updateTotalsFromNotas();
        }
      });
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
              if (tokenInput) tokenInput.value = codes[0].rawValue;
              await validateCheckin(codes[0].rawValue);
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
    setValue('internalQuantidadeNotas', notas.length);
    setValue('internalQuantidadeVolumes', totalVolumes.toFixed(3));
    setValue('internalPesoTotalKg', totalPeso.toFixed(3));
    setValue('internalValorTotalNf', totalValor.toFixed(2));
  }

  function renderPendingNotasInterno() {
    const wrap = byId('internalPendingNotas');
    if (!wrap) return;
    const notas = Array.isArray(state.internalPendingFornecedor?.notas) ? state.internalPendingFornecedor.notas : [];
    if (!notas.length) {
      wrap.innerHTML = '<div class="warning-box">Selecione um fornecedor pendente para carregar as NF disponíveis.</div>';
      state.internalSelectedNotas = [];
      updateInternalTotals();
      return;
    }
    wrap.innerHTML = `<div class="pending-notas-grid">${notas.map((nota, idx) => `
      <div class="pending-nota-item">
        <label>
          <input type="checkbox" data-internal-nf="${idx}" checked />
          <span class="pending-nota-meta">
            <strong>NF ${escapeHtml(nota.numeroNf || '-')}</strong>
            <span>Volumes: ${escapeHtml(Number(nota.volumes || 0).toFixed(3))}</span>
            <span>Peso: ${escapeHtml(Number(nota.peso || 0).toFixed(3))} kg</span>
            <span>Valor: ${escapeHtml(Number(nota.valorNf || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }))}</span>
          </span>
        </label>
      </div>`).join('')}</div>`;
    const sync = () => {
      state.internalSelectedNotas = notas.filter((_nota, index) => wrap.querySelector(`[data-internal-nf="${index}"]`)?.checked);
      updateInternalTotals();
    };
    wrap.querySelectorAll('[data-internal-nf]').forEach((el) => el.addEventListener('change', sync));
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
      state.internalPendingFornecedores = Array.isArray(items) ? items : [];
      const select = byId('internalFornecedorPendenteSelect');
      if (!select) return;
      const currentValue = String(select.value || '');
      select.innerHTML = `<option value="">Selecione o fornecedor pendente</option>` + state.internalPendingFornecedores.map((item, index) => {
        const optionValue = String(item?.id ?? index + 1);
        return `<option value="${escapeHtml(optionValue)}">${escapeHtml(item.fornecedor || item.nome || '-')} (${escapeHtml(item.quantidadeNotas ?? 0)} NF)</option>`;
      }).join('');
      const hasCurrentValue = state.internalPendingFornecedores.some((item, index) => String(item?.id ?? index + 1) === currentValue);
      select.value = hasCurrentValue ? currentValue : '';
      select.onchange = () => {
        if (!select.value) {
          state.internalPendingFornecedor = null;
          state.internalSelectedNotas = [];
          const fornecedorField = byId('internalFornecedorNome');
          if (fornecedorField) fornecedorField.value = '';
          renderPendingNotasInterno();
          return;
        }
        const selected = state.internalPendingFornecedores.find((item, index) => String(item?.id ?? index + 1) === String(select.value));
        applyFornecedorPendenteInterno(selected || null);
      };
      if (select.value) {
        const selected = state.internalPendingFornecedores.find((item, index) => String(item?.id ?? index + 1) === String(select.value));
        applyFornecedorPendenteInterno(selected || null);
      } else {
        renderPendingNotasInterno();
      }
    } catch {}
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
    } catch {}
  }

  async function loadDashboard() {
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k, v]) => { if (v) params.set(k, v); });
    const data = await api(`/api/dashboard/operacional?${params.toString()}`);
    const kpis = byId("kpis");
    if (kpis) {
      kpis.innerHTML = "";
      Object.entries(data.kpis || {}).forEach(([k, v]) => {
        const div = document.createElement("div");
        div.className = "kpi";
        div.innerHTML = `<strong>${escapeHtml(k)}</strong><span>${escapeHtml(v)}</span>`;
        kpis.appendChild(div);
      });
    }
    byId("dashboardTable").innerHTML = tableFromObjects((data.agendamentos || []).map((a) => ({
      id: a.id,
      protocolo: a.protocolo,
      status: a.status,
      fornecedor: a.fornecedor,
      transportadora: a.transportadora,
      motorista: a.motorista,
      placa: a.placa,
      doca: a.doca?.codigo || "",
      janela: a.janela?.codigo || "",
      data: a.dataAgendada,
      hora: a.horaAgendada,
      volumes: a.quantidadeVolumes || 0,
      pesoKg: a.pesoTotalKg || 0,
      valorTotal: a.valorTotalNf || 0
    })));
  }

  function semaforoClass(v) {
    const s = String(v || "").toLowerCase();
    if (s.includes("verde")) return "verde";
    if (s.includes("amarelo")) return "amarelo";
    return "vermelho";
  }

  async function chooseDocaForAgendamento(agendamentoId) {
    const docas = await api('/api/cadastros/docas');
    const disponiveis = (Array.isArray(docas) ? docas : []).filter((doca) => String(doca.codigo || '').toUpperCase() !== 'A DEFINIR');
    if (!disponiveis.length) throw new Error('Nenhuma doca cadastrada para seleção.');
    const promptText = ['Informe o ID da doca para o agendamento:']
      .concat(disponiveis.map((doca) => `${doca.id} - ${doca.codigo}${doca.descricao ? ` (${doca.descricao})` : ''}`))
      .join('\n');
    const resposta = window.prompt(promptText, String(disponiveis[0].id));
    if (resposta == null) return false;
    const escolhida = disponiveis.find((doca) => String(doca.id) === String(resposta).trim());
    if (!escolhida) throw new Error('Doca inválida.');
    await api(`/api/agendamentos/${agendamentoId}/definir-doca`, { method: 'POST', body: JSON.stringify({ docaId: escolhida.id }) });
    return true;
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
            const canDefineDoca = ['APROVADO', 'CHEGOU'].includes(String(f.status || ''));
            const buttonLabel = String(d.codigo || '').toUpperCase() === 'A DEFINIR' ? 'Definir doca' : 'Alterar doca';
            return `
              <div class="fila-item">
                <div><strong>${escapeHtml(f.protocolo)}</strong> • ${escapeHtml(f.motorista)}</div>
                <div>${escapeHtml(f.placa)} • ${escapeHtml(f.horaAgendada)} • ${escapeHtml(f.status)}</div>
                ${canDefineDoca ? `<div class="mt12"><button type="button" class="btn-secondary" data-definir-doca="${escapeHtml(f.id)}">${buttonLabel}</button></div>` : ""}
              </div>
            `;
          }).join("") : "<div class='fila-item'>Sem fila</div>"}
        </div>
      </div>
    `).join("");

    wrap.querySelectorAll('[data-definir-doca]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          const changed = await chooseDocaForAgendamento(button.getAttribute('data-definir-doca'));
          if (!changed) return;
          await Promise.allSettled([loadDocas(), loadAgendamentos(), loadDashboard()]);
          byId('operacaoMsg').textContent = 'Doca definida com sucesso.';
        } catch (err) {
          byId('operacaoMsg').textContent = err.message || 'Não foi possível definir a doca.';
        }
      });
    });
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
    byId("agendamentosList").innerHTML = tableFromObjects(items.map((i) => ({
      id: i.id,
      protocolo: i.protocolo,
      status: i.status,
      fornecedor: i.fornecedor,
      transportadora: i.transportadora,
      motorista: i.motorista,
      placa: i.placa,
      doca: i.doca?.codigo || "",
      janela: i.janela?.codigo || "",
      data: i.dataAgendada,
      hora: i.horaAgendada,
      semaforo: i.semaforo || ""
    })));
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
      await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas()]);
    } catch (err) {
      byId("operacaoMsg").textContent = err.message;
    }
  }

  async function validateCheckin(token) {
    try {
      const modo = byId("checkinForm")?.querySelector("[name=modo]")?.value || "checkin";
      const endpoint = modo === "checkout" ? `/api/public/checkout/${encodeURIComponent(token)}` : `/api/public/checkin/${encodeURIComponent(token)}`;
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
      await Promise.allSettled([loadDashboard(), loadAgendamentos(), loadDocas()]);
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
        showView("dashboard");
        await loadDashboard();
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
        payload.cpfMotorista = String(payload.cpfMotorista || '').replace(/\D/g, '');
        payload.notasFiscais = selectedInternalNotas();
        payload.quantidadeNotas = Number(payload.notasFiscais.length || 0);
        payload.quantidadeVolumes = Number(byId('internalQuantidadeVolumes')?.value || 0);
        payload.pesoTotalKg = Number(byId('internalPesoTotalKg')?.value || 0);
        payload.valorTotalNf = Number(byId('internalValorTotalNf')?.value || 0);
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
        document.querySelectorAll('#agendamentoForm input[type="date"]').forEach((el) => { el.value = new Date().toISOString().slice(0, 10); });
        await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas(), loadFornecedoresPendentesInterno()]);
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
      await validateCheckin(new FormData(e.target).get("token"));
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
    if (view === "checkin") {
      showView(state.token && !isTokenExpired(state.token) ? "checkin" : "login");
      if (token) byId("checkinForm")?.querySelector('input[name="token"]').setAttribute("value", token);
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
