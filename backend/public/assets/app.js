(() => {
  const state = {
    token: localStorage.getItem("token") || "",
    cadastroTipo: "fornecedores",
    nfRows: 1,
    nfDrafts: [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }],
<<<<<<< HEAD
    disponibilidadePublica: [],
=======
>>>>>>> 557e63be127f44cb90c0d9f5d6a12940bef1e45d
    stream: null,
    detectorTimer: null
  };

  function byId(id) { return document.getElementById(id); }

  function showView(id) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    byId(id)?.classList.add("active");
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
    byId("publicNav").classList.toggle("hidden", logged);
    byId("privateNav").classList.toggle("hidden", !logged);
    if (!logged && state.token) logout();
  }

  async function api(url, options = {}) {
    const headers = options.headers || {};
    if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (state.token && !isTokenExpired(state.token)) headers["Authorization"] = `Bearer ${state.token}`;
    const res = await fetch(url, { ...options, headers });
    const ct = res.headers.get("content-type") || "";
    const data = ct.includes("application/json") ? await res.json() : await res.text();
    if (res.status === 401) {
      logout();
    }
    if (!res.ok) throw new Error(data.message || data || "Erro na requisição");
    return data;
  }

  function tableFromObjects(items) {
    if (!items?.length) return "<p>Nenhum registro.</p>";
    const cols = Object.keys(items[0]).filter(k => typeof items[0][k] !== "object");
    return `<table class="table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${items.map(row => `<tr>${cols.map(c => `<td>${row[c] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function ensureNfDraftSize() {
    while (state.nfDrafts.length < state.nfRows) {
      state.nfDrafts.push({ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" });
    }
    if (state.nfDrafts.length > state.nfRows) {
      state.nfDrafts = state.nfDrafts.slice(0, state.nfRows);
    }
  }

  function syncNfDraftsFromDom() {
    document.querySelectorAll("[data-nf]").forEach(el => {
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
    for (let i = 0; i < state.nfRows; i++) {
      const row = state.nfDrafts[i] || {};
      const div = document.createElement("div");
      div.className = "grid2 mt12 nf-row";
      div.innerHTML = `
        <label>Número NF<input data-nf="${i}" data-field="numeroNf" value="${row.numeroNf || ""}" /></label>
        <label>Série<input data-nf="${i}" data-field="serie" value="${row.serie || ""}" /></label>
        <label>Chave de acesso<input data-nf="${i}" data-field="chaveAcesso" value="${row.chaveAcesso || ""}" /></label>
        <label>Volumes<input data-nf="${i}" data-field="volumes" type="number" min="0" value="${row.volumes ?? "0"}" /></label>
        <label>Peso<input data-nf="${i}" data-field="peso" type="number" min="0" step="0.001" value="${row.peso ?? "0"}" /></label>
        <label>Valor NF<input data-nf="${i}" data-field="valorNf" type="number" min="0" step="0.01" value="${row.valorNf ?? "0"}" /></label>
        <label class="nf-full">Observação<textarea data-nf="${i}" data-field="observacao">${row.observacao || ""}</textarea></label>
      `;
      wrap.appendChild(div);
    }
    wrap.querySelectorAll("[data-nf]").forEach(el => {
      el.addEventListener("input", syncNfDraftsFromDom);
      el.addEventListener("change", syncNfDraftsFromDom);
    });
  }

  function collectNotas() {
    syncNfDraftsFromDom();
    return state.nfDrafts
      .map(nota => ({
        numeroNf: String(nota.numeroNf || "").trim(),
        serie: String(nota.serie || "").trim(),
        chaveAcesso: String(nota.chaveAcesso || "").trim(),
        volumes: Number(nota.volumes || 0),
        peso: Number(nota.peso || 0),
        valorNf: Number(nota.valorNf || 0),
        observacao: String(nota.observacao || "").trim()
      }))
      .filter(x => x.numeroNf || x.chaveAcesso);
<<<<<<< HEAD
  }


  function renderPublicDates() {
    const dateSelect = byId("publicDataSelect");
    const janelaSelect = byId("publicJanelaSelect");
    const horaInput = byId("publicHoraInput");
    if (!dateSelect || !janelaSelect || !horaInput) return;
    const datas = state.disponibilidadePublica.filter((item) => item.disponivel);
    dateSelect.innerHTML = datas.map((item) => `<option value="${item.data}">${item.data}</option>`).join("");
    if (!dateSelect.value && datas[0]) dateSelect.value = datas[0].data;
    renderPublicSlots(dateSelect.value);
  }

  function renderPublicSlots(data) {
    const janelaSelect = byId("publicJanelaSelect");
    const horaInput = byId("publicHoraInput");
    if (!janelaSelect || !horaInput) return;
    const dia = state.disponibilidadePublica.find((item) => item.data === data) || { horarios: [] };
    const horarios = (dia.horarios || []).filter((slot) => slot.disponivel);
    janelaSelect.innerHTML = horarios.map((slot) => `<option value="${slot.janelaId}" data-hora="${slot.hora}">${slot.hora}${slot.descricao ? ` - ${slot.descricao}` : ""} (${slot.capacidade - slot.ocupados} vagas)</option>`).join("");
    const selected = horarios.find((slot) => String(slot.janelaId) === String(janelaSelect.value)) || horarios[0];
    if (selected) { janelaSelect.value = String(selected.janelaId); horaInput.value = selected.hora; } else { horaInput.value = ""; }
  }

  async function loadPublicDisponibilidade() {
    const data = await api(`/api/public/disponibilidade?dias=21`);
    state.disponibilidadePublica = Array.isArray(data.agenda) ? data.agenda : [];
    renderPublicDates();
=======
>>>>>>> 557e63be127f44cb90c0d9f5d6a12940bef1e45d
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
      const docaOptions = docas.map(d => `<option value="${d.id}">${d.codigo}</option>`).join("");
      const janelaOptions = janelas.map(j => `<option value="${j.id}">${j.codigo}</option>`).join("");
      ["internalDocaSelect"].forEach(id => { const el = byId(id); if (el) el.innerHTML = docaOptions; });
      ["internalJanelaSelect"].forEach(id => { const el = byId(id); if (el) el.innerHTML = janelaOptions; });
    } catch {}
  }

  async function loadDashboard() {
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k,v]) => { if (v) params.set(k, v); });
    const data = await api(`/api/dashboard/operacional?${params.toString()}`);
    const kpis = byId("kpis");
    kpis.innerHTML = "";
    Object.entries(data.kpis).forEach(([k,v]) => {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<strong>${k}</strong><span>${v}</span>`;
      kpis.appendChild(div);
    });
    byId("dashboardTable").innerHTML = tableFromObjects(data.agendamentos.map(a => ({
      id: a.id, protocolo: a.protocolo, status: a.status, fornecedor: a.fornecedor,
      transportadora: a.transportadora, motorista: a.motorista, placa: a.placa,
      doca: a.doca?.codigo || "", janela: a.janela?.codigo || "", data: a.dataAgendada, hora: a.horaAgendada
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
    wrap.innerHTML = data.map(d => `
      <div class="doca-card sem-${String(d.semaforo).toLowerCase()}">
        <h3>${d.codigo}</h3>
        <p>${d.descricao || ""}</p>
        <p><strong>Ocupação:</strong> ${d.ocupacaoAtual}</p>
        <span class="badge ${semaforoClass(d.semaforo)}">${d.semaforo}</span>
        <div class="mt12">
          <strong>Fila (${d.fila.length})</strong>
          ${d.fila.length ? d.fila.map(f => `
            <div class="fila-item">
              <div><strong>${f.protocolo}</strong> • ${f.motorista}</div>
              <div>${f.placa} • ${f.horaAgendada} • ${f.status}</div>
            </div>
          `).join("") : "<div class='fila-item'>Sem fila</div>"}
        </div>
      </div>
    `).join("");
  }

  async function loadCadastro() {
    const items = await api(`/api/cadastros/${state.cadastroTipo}`);
    byId("cadastroList").innerHTML = tableFromObjects(items);
  }

  async function loadAgendamentos() {
    const params = new URLSearchParams();
    Object.entries(currentFilters()).forEach(([k,v]) => { if (v) params.set(k, v); });
    const items = await api(`/api/agendamentos?${params.toString()}`);
    byId("agendamentosList").innerHTML = tableFromObjects(items.map(i => ({
      id: i.id, protocolo: i.protocolo, status: i.status, fornecedor: i.fornecedor, transportadora: i.transportadora,
      motorista: i.motorista, placa: i.placa, doca: i.doca?.codigo || "", janela: i.janela?.codigo || "", data: i.dataAgendada,
      hora: i.horaAgendada, semaforo: i.semaforo || "",
      voucher_motorista: i.notificacoes?.voucherMotorista ? "SIM" : "NÃO",
      voucher_transportadora_fornecedor: i.notificacoes?.voucherTransportadoraFornecedor ? "SIM" : "NÃO",
      confirmacao_transportadora_fornecedor: i.notificacoes?.confirmacaoTransportadoraFornecedor ? "SIM" : "NÃO"
    })));
  }

  function currentId() {
    const id = byId("agendamentoId").value;
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

  async function scanLoop() {
    if (!("BarcodeDetector" in window) || !state.stream) return;
    const video = byId("qrVideo");
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    state.detectorTimer = setInterval(async () => {
      try {
        const codes = await detector.detect(video);
        if (codes.length) {
          const raw = codes[0].rawValue || "";
          const url = new URL(raw, window.location.origin);
          const token = url.searchParams.get("token") || raw;
          byId("checkinForm").querySelector('input[name="token"]').value = token;
          await validateCheckin(token);
          stopCamera();
        }
      } catch {}
    }, 900);
  }

  async function startCamera() {
    const video = byId("qrVideo");
    state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    video.srcObject = state.stream;
    await video.play();
    await scanLoop();
  }

  function stopCamera() {
    if (state.detectorTimer) clearInterval(state.detectorTimer);
    state.detectorTimer = null;
    if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
    const video = byId("qrVideo");
    if (video) video.srcObject = null;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    updateNav();
    renderNfRows();

    document.querySelectorAll("[data-view]").forEach(btn => {
      btn.addEventListener("click", () => showView(btn.dataset.view));
    });

    byId("btnLogout")?.addEventListener("click", logout);

    byId("applyFilters")?.addEventListener("click", async () => {
      try { await loadDashboard(); await loadAgendamentos(); } catch (err) { alert(err.message); }
    });

    byId("clearFilters")?.addEventListener("click", async () => {
      ["fStatus","fFornecedor","fTransportadora","fMotorista","fPlaca","fData"].forEach(id => { if (byId(id)) byId(id).value = ""; });
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

    document.querySelectorAll(".cad-tab").forEach(btn => {
      btn.addEventListener("click", async () => {
        state.cadastroTipo = btn.dataset.tipo;
        byId("cadastroMsg").textContent = `Tipo atual: ${state.cadastroTipo}`;
        await loadCadastro();
      });
    });

    byId("saveCadastro")?.addEventListener("click", async () => {
      try {
        const payload = JSON.parse(byId("cadastroJson").value);
        await api(`/api/cadastros/${state.cadastroTipo}`, { method: "POST", body: JSON.stringify(payload) });
        byId("cadastroMsg").textContent = "Cadastro salvo.";
        await loadCadastro();
        await fillSelects();
      } catch (err) {
        byId("cadastroMsg").textContent = err.message;
      }
    });

    byId("loadCadastro")?.addEventListener("click", async () => {
      try { await loadCadastro(); } catch (err) { byId("cadastroMsg").textContent = err.message; }
    });

    byId("agendamentoForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const payload = Object.fromEntries(new FormData(e.target).entries());
        const data = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(payload) });
        byId("agendamentoId").value = data.id || "";
        byId("agendamentoMsg").textContent = `Agendamento criado: ${data.protocolo} | ID: ${data.id}`;
        e.target.reset();
        document.querySelectorAll('#agendamentoForm input[type="date"]').forEach(el => { el.value = new Date().toISOString().slice(0,10); });
        await Promise.allSettled([loadAgendamentos(), loadDashboard(), loadDocas()]);
      } catch (err) {
        byId("agendamentoMsg").textContent = err.message;
      }
    });

    byId("loadAgendamentos")?.addEventListener("click", async () => {
      try { await loadAgendamentos(); } catch (err) { byId("operacaoMsg").textContent = err.message; }
    });

    byId("btnAprovar")?.addEventListener("click", async () => handleOp(() => postStatus("aprovar", { docaId: byId("internalDocaSelect")?.value, janelaId: byId("internalJanelaSelect")?.value }), "Agendamento aprovado."));
    byId("btnReprovar")?.addEventListener("click", async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado."));
    byId("btnReagendar")?.addEventListener("click", async () => handleOp(() => postStatus("reagendar", {
      dataAgendada: new Date().toISOString().slice(0,10),
      horaAgendada: "10:00",
      docaId: byId("internalDocaSelect")?.value,
      janelaId: byId("internalJanelaSelect")?.value
    }), "Agendamento reagendado."));
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
        payload.lgpdConsent = !!e.target.querySelector('[name="lgpdConsent"]').checked;
        payload.notas = collectNotas();
        payload.quantidadeNotas = payload.notas.length;
        const data = await api("/api/public/solicitacao", { method: "POST", body: JSON.stringify(payload) });
<<<<<<< HEAD
        byId("fornecedorMsg").textContent = `Solicitação enviada. Protocolo: ${data.protocolo}. O voucher e as confirmações serão disparados pelo operador.`;
=======
        byId("fornecedorMsg").textContent = `Solicitação enviada. Protocolo: ${data.protocolo}. Link motorista: ${data.linkMotorista}`;
>>>>>>> 557e63be127f44cb90c0d9f5d6a12940bef1e45d
        e.target.reset();
        state.nfRows = 1;
        state.nfDrafts = [{ numeroNf: "", serie: "", chaveAcesso: "", volumes: "0", peso: "0", valorNf: "0", observacao: "" }];
        renderNfRows();
<<<<<<< HEAD
        await loadPublicDisponibilidade();
=======
        document.querySelectorAll('#fornecedorForm input[type="date"]').forEach(el => { el.value = new Date().toISOString().slice(0,10); });
>>>>>>> 557e63be127f44cb90c0d9f5d6a12940bef1e45d
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

    byId("startCamera")?.addEventListener("click", async () => {
      try { await startCamera(); } catch { byId("checkinMsg").textContent = "Falha ao acessar câmera."; }
    });
    byId("stopCamera")?.addEventListener("click", stopCamera);

    byId("publicDataSelect")?.addEventListener("change", (e) => renderPublicSlots(e.target.value));
    byId("publicJanelaSelect")?.addEventListener("change", (e) => { const option = e.target.selectedOptions?.[0]; if (option) byId("publicHoraInput").value = option.dataset.hora || ""; });

    if (state.token && !isTokenExpired(state.token)) {
      await fillSelects();
    }
    await loadPublicDisponibilidade();

    const params = new URLSearchParams(location.search);
    const view = params.get("view");
    const token = params.get("token");
    if (view === "checkin") {
      showView(state.token && !isTokenExpired(state.token) ? "checkin" : "login");
      if (token) {
        byId("checkinForm").querySelector('input[name="token"]').value = token;
      }
      if (!state.token || isTokenExpired(state.token)) {
        byId("loginMsg").textContent = "O check-in do QR Code deve ser validado pelo operador do recebimento.";
      }
    } else if (view === "motorista" && token) {
      showView("motorista");
      byId("motoristaConsultaForm").querySelector('input[name="token"]').value = token;
      byId("motoristaConsultaForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else if (view === "fornecedor") {
      showView("fornecedor");
    }
  });

  window.addEventListener("error", (e) => {
    if (e.filename && e.filename.includes("chrome-extension")) {
      e.stopImmediatePropagation();
      return true;
    }
  });
})();
