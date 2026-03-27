(() => {
  const state = {
    token: localStorage.getItem("token") || "",
    cadastroTipo: "fornecedores",
    cadastroEditId: null,
    cadastroCache: [],
    nfRows: 1,
    nfDrafts: [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }],
    disponibilidadePublica: []
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
    const res = await fetch(url, { ...options, headers });
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
        <label>Chave de acesso<input data-nf="${i}" data-field="chaveAcesso" value="${escapeHtml(row.chaveAcesso || "")}" /></label>
        <label>Volumes<input data-nf="${i}" data-field="volumes" type="number" min="0" value="${escapeHtml(row.volumes ?? "0")}" /></label>
        <label>Peso<input data-nf="${i}" data-field="peso" type="number" min="0" step="0.001" value="${escapeHtml(row.peso ?? "0")}" /></label>
        <label>Valor NF<input data-nf="${i}" data-field="valorNf" type="number" min="0" step="0.01" value="${escapeHtml(row.valorNf ?? "0")}" /></label>
        <label class="nf-full">Observação<textarea data-nf="${i}" data-field="observacao">${escapeHtml(row.observacao || "")}</textarea></label>
      `;
      wrap.appendChild(div);
    }
    wrap.querySelectorAll("[data-nf]").forEach((el) => {
      el.addEventListener("input", syncNfDraftsFromDom);
      el.addEventListener("change", syncNfDraftsFromDom);
    });
  }

  function collectNotas() {
    syncNfDraftsFromDom();
    return state.nfDrafts
      .map((nota) => ({
        numeroNf: String(nota.numeroNf || "").trim(),
        serie: String(nota.serie || "").trim(),
        chaveAcesso: String(nota.chaveAcesso || "").trim(),
        volumes: Number(nota.volumes || 0),
        peso: Number(nota.peso || 0),
        valorNf: Number(nota.valorNf || 0),
        observacao: String(nota.observacao || "").trim()
      }))
      .filter((item) => item.numeroNf || item.chaveAcesso);
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
      const [docas, janelas] = await Promise.all([
        api("/api/cadastros/docas"),
        api("/api/cadastros/janelas")
      ]);
      const docaOptions = docas.map((d) => `<option value="${d.id}">${escapeHtml(d.codigo)}</option>`).join("");
      const janelaOptions = janelas.map((j) => `<option value="${j.id}">${escapeHtml(j.codigo)}</option>`).join("");
      const docaSelect = byId("internalDocaSelect");
      const janelaSelect = byId("internalJanelaSelect");
      if (docaSelect) docaSelect.innerHTML = docaOptions;
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
      hora: a.horaAgendada
    })));
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
          ${d.fila.length ? d.fila.map((f) => `
            <div class="fila-item">
              <div><strong>${escapeHtml(f.protocolo)}</strong> • ${escapeHtml(f.motorista)}</div>
              <div>${escapeHtml(f.placa)} • ${escapeHtml(f.horaAgendada)} • ${escapeHtml(f.status)}</div>
            </div>
          `).join("") : "<div class='fila-item'>Sem fila</div>"}
        </div>
      </div>
    `).join("");
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
      const id = byId("agendamentoId")?.value || new URLSearchParams(location.search).get("id");
      if (!id) throw new Error("Informe o ID do agendamento para validar o QR no recebimento.");
      const data = await api(`/api/agendamentos/${id}/checkin`, { method: "POST", body: JSON.stringify({ token }) });
      byId("checkinMsg").textContent = data.message;
      byId("checkinResult").textContent = JSON.stringify(data.agendamento, null, 2);
      await Promise.allSettled([loadDashboard(), loadAgendamentos(), loadDocas()]);
    } catch (err) {
      byId("checkinMsg").textContent = err.message;
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    updateNav();
    renderNfRows();
    renderCadastroForm();

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
        byId("loginMsg").textContent = err.message;
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
        const data = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(payload) });
        byId("agendamentoId").value = data.id || "";
        byId("agendamentoMsg").textContent = `Agendamento criado: ${data.protocolo} | ID: ${data.id}`;
        e.target.reset();
        document.querySelectorAll('#agendamentoForm input[type="date"]').forEach((el) => { el.value = new Date().toISOString().slice(0, 10); });
        await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas()]);
      } catch (err) {
        byId("agendamentoMsg").textContent = err.message;
      }
    });

    byId("loadAgendamentos")?.addEventListener("click", async () => { try { await loadAgendamentos(); } catch (err) { byId("operacaoMsg").textContent = err.message; } });
    byId("btnAprovar")?.addEventListener("click", async () => handleOp(() => postStatus("aprovar", { docaId: byId("internalDocaSelect")?.value, janelaId: byId("internalJanelaSelect")?.value }), "Agendamento aprovado."));
    byId("btnReprovar")?.addEventListener("click", async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado."));
    byId("btnReagendar")?.addEventListener("click", async () => handleOp(() => postStatus("reagendar", { dataAgendada: new Date().toISOString().slice(0, 10), horaAgendada: "10:00", docaId: byId("internalDocaSelect")?.value, janelaId: byId("internalJanelaSelect")?.value }), "Agendamento reagendado."));
    byId("btnCancelar")?.addEventListener("click", async () => handleOp(() => postStatus("cancelar", { motivo: "Cancelado via painel" }), "Agendamento cancelado."));
    byId("btnIniciar")?.addEventListener("click", async () => handleOp(() => postStatus("iniciar"), "Descarga iniciada."));
    byId("btnFinalizar")?.addEventListener("click", async () => handleOp(() => postStatus("finalizar"), "Agendamento finalizado."));
    byId("btnNoShow")?.addEventListener("click", async () => handleOp(() => postStatus("no-show"), "Agendamento marcado como no-show."));
    byId("btnVoucher")?.addEventListener("click", () => { try { window.open(`/api/agendamentos/${currentId()}/voucher`, "_blank"); } catch (err) { alert(err.message); } });
    byId("btnQr")?.addEventListener("click", () => { try { window.open(`/api/agendamentos/${currentId()}/qrcode.svg`, "_blank"); } catch (err) { alert(err.message); } });
    byId("btnEnviarInfos")?.addEventListener("click", async () => handleOp(() => api(`/api/agendamentos/${currentId()}/enviar-informacoes`, { method: "POST", body: JSON.stringify({}) }), "Informações enviadas."));

    byId("btnUploadDoc")?.addEventListener("click", async () => {
      try {
        const id = currentId();
        const file = byId("docFile").files[0];
        if (!file) throw new Error("Selecione um arquivo.");
        const fd = new FormData();
        fd.append("tipoDocumento", "ANEXO");
        fd.append("arquivo", file);
        await api(`/api/agendamentos/${id}/documentos`, { method: "POST", body: fd });
        byId("operacaoMsg").textContent = "Documento enviado.";
        await loadAgendamentos();
      } catch (err) {
        byId("operacaoMsg").textContent = err.message;
      }
    });

    byId("notaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const id = currentId();
        const payload = Object.fromEntries(new FormData(e.target).entries());
        await api(`/api/agendamentos/${id}/notas`, { method: "POST", body: JSON.stringify(payload) });
        byId("operacaoMsg").textContent = "NF salva.";
        await loadAgendamentos();
      } catch (err) {
        byId("operacaoMsg").textContent = err.message;
      }
    });

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
        payload.quantidadeNotas = payload.notas.length;
        const data = await api("/api/public/solicitacao", { method: "POST", body: JSON.stringify(payload) });
        byId("fornecedorMsg").textContent = `Solicitação enviada. Protocolo: ${data.protocolo}. Horário: ${data.horaAgendada}. Doca: ${data.doca}.`;
        e.target.reset();
        state.nfRows = 1;
        state.nfDrafts = [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }];
        renderNfRows();
        await loadPublicDisponibilidade();
      } catch (err) {
        byId("fornecedorMsg").textContent = err.message;
      }
    });

    byId("motoristaConsultaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const token = new FormData(e.target).get("token");
        const data = await api(`/api/public/motorista/${token}`);
        byId("motoristaResult").textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        byId("motoristaResult").textContent = err.message;
      }
    });

    byId("checkinForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      await validateCheckin(new FormData(e.target).get("token"));
    });

    byId("publicDataSelect")?.addEventListener("change", (e) => renderPublicSlots(e.target.value));

    if (state.token && !isTokenExpired(state.token)) {
      await fillSelects();
      try { await loadCadastro(); } catch {}
    }

    try {
      await loadPublicDisponibilidade();
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
    } else if (view === "fornecedor") {
      showView("fornecedor");
    }
  });
})();
