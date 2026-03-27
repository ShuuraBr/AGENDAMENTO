const state = {
  token: localStorage.getItem("token") || "",
  cadastroTipo: "fornecedores",
  nfRows: 1,
  stream: null,
  detectorTimer: null,
  role: null
};

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

function parseJwt(token) {
  try { return JSON.parse(atob(token.split(".")[1])); } catch { return null; }
}

function updateNav() {
  const logged = !!state.token;
  document.getElementById("publicNav").classList.toggle("hidden", logged);
  document.getElementById("privateNav").classList.toggle("hidden", !logged);
}

document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
document.getElementById("btnLogout")?.addEventListener("click", () => {
  localStorage.removeItem("token");
  state.token = "";
  state.role = null;
  updateNav();
  showView("public-home");
});

async function api(url, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(url, { ...options, headers });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.message || data || "Erro na requisição");
  return data;
}

function tableFromObjects(items) {
  if (!items?.length) return "<p>Nenhum registro.</p>";
  const cols = Object.keys(items[0]).filter(k => typeof items[0][k] !== "object");
  return `<table class="table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead><tbody>${items.map(row => `<tr>${cols.map(c => `<td>${row[c] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function renderNfRows() {
  const wrap = document.getElementById("nfList");
  wrap.innerHTML = "";
  for (let i = 0; i < state.nfRows; i++) {
    const div = document.createElement("div");
    div.className = "grid2 mt12";
    div.innerHTML = `
      <label>Número NF<input data-nf="${i}" data-field="numeroNf" /></label>
      <label>Série<input data-nf="${i}" data-field="serie" /></label>
      <label>Chave de acesso<input data-nf="${i}" data-field="chaveAcesso" /></label>
      <label>Volumes<input data-nf="${i}" data-field="volumes" type="number" value="0" /></label>
      <label>Peso<input data-nf="${i}" data-field="peso" type="number" value="0" /></label>
      <label>Valor NF<input data-nf="${i}" data-field="valorNf" type="number" value="0" /></label>
    `;
    wrap.appendChild(div);
  }
}

function collectNotas() {
  const map = {};
  document.querySelectorAll("[data-nf]").forEach(el => {
    const idx = el.dataset.nf;
    const field = el.dataset.field;
    map[idx] ??= {};
    map[idx][field] = el.value;
  });
  return Object.values(map).filter(x => x.numeroNf || x.chaveAcesso);
}

function currentFilters() {
  return {
    status: document.getElementById("fStatus").value,
    fornecedor: document.getElementById("fFornecedor").value,
    transportadora: document.getElementById("fTransportadora").value,
    motorista: document.getElementById("fMotorista").value,
    placa: document.getElementById("fPlaca").value,
    dataAgendada: document.getElementById("fData").value
  };
}

async function fillSelects() {
  try {
    const [docas, janelas] = await Promise.all([
      api("/api/cadastros/docas"),
      api("/api/cadastros/janelas")
    ]);
    const docaOptions = docas.map(d => `<option value="${d.id}">${d.codigo}</option>`).join("");
    const janelaOptions = janelas.map(j => `<option value="${j.id}">${j.codigo}</option>`).join("");
    ["publicDocaSelect","internalDocaSelect"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = docaOptions; });
    ["publicJanelaSelect","internalJanelaSelect"].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = janelaOptions; });
  } catch {}
}

async function loadDashboard() {
  const params = new URLSearchParams();
  Object.entries(currentFilters()).forEach(([k,v]) => { if (v) params.set(k, v); });
  const data = await api(`/api/dashboard/operacional?${params.toString()}`);
  const kpis = document.getElementById("kpis");
  kpis.innerHTML = "";
  Object.entries(data.kpis).forEach(([k,v]) => {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<strong>${k}</strong><span>${v}</span>`;
    kpis.appendChild(div);
  });
  document.getElementById("dashboardTable").innerHTML = tableFromObjects(data.agendamentos.map(a => ({
    id: a.id, protocolo: a.protocolo, status: a.status, fornecedor: a.fornecedor,
    transportadora: a.transportadora, motorista: a.motorista, placa: a.placa,
    doca: a.doca?.codigo || "", janela: a.janela?.codigo || "", data: a.dataAgendada,
    hora: a.horaAgendada, notas: a.notasFiscais?.length || 0, docs: a.documentos?.length || 0,
    semaforo: a.semaforo || ""
  })));
}

function semaforoClass(v) {
  const s = String(v || "").toLowerCase();
  if (s.includes("verde")) return "verde";
  if (s.includes("amarelo")) return "amarelo";
  return "vermelho";
}

async function loadDocas() {
  const date = document.getElementById("docaData").value;
  const data = await api(`/api/dashboard/docas${date ? `?dataAgendada=${encodeURIComponent(date)}` : ""}`);
  const wrap = document.getElementById("docaPainel");
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
  document.getElementById("cadastroList").innerHTML = tableFromObjects(items);
}

async function loadAgendamentos() {
  const params = new URLSearchParams();
  Object.entries(currentFilters()).forEach(([k,v]) => { if (v) params.set(k, v); });
  const items = await api(`/api/agendamentos?${params.toString()}`);
  document.getElementById("agendamentosList").innerHTML = tableFromObjects(items.map(i => ({
    id: i.id, protocolo: i.protocolo, status: i.status, fornecedor: i.fornecedor, transportadora: i.transportadora,
    motorista: i.motorista, placa: i.placa, doca: i.doca?.codigo || "", janela: i.janela?.codigo || "", data: i.dataAgendada,
    hora: i.horaAgendada, notas: i.notasFiscais?.length || 0, docs: i.documentos?.length || 0, semaforo: i.semaforo || ""
  })));
}

document.getElementById("applyFilters").onclick = async () => {
  try { await loadDashboard(); await loadAgendamentos(); } catch (err) { alert(err.message); }
};
document.getElementById("clearFilters").onclick = async () => {
  ["fStatus","fFornecedor","fTransportadora","fMotorista","fPlaca","fData"].forEach(id => document.getElementById(id).value = "");
  try { await loadDashboard(); await loadAgendamentos(); } catch (err) { alert(err.message); }
};

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const data = await api("/api/auth/login", { method: "POST", body: JSON.stringify(payload) });
    state.token = data.token;
    localStorage.setItem("token", data.token);
    state.role = parseJwt(data.token)?.perfil || data.user?.perfil || null;
    updateNav();
    await fillSelects();
    showView("dashboard");
    await loadDashboard();
    document.getElementById("loginMsg").textContent = `Logado como ${data.user.nome} (${data.user.perfil})`;
  } catch (err) {
    document.getElementById("loginMsg").textContent = err.message;
  }
});

document.getElementById("loadDashboard").addEventListener("click", async () => {
  try { await loadDashboard(); } catch (err) { alert(err.message); }
});
document.getElementById("loadDocas").addEventListener("click", async () => {
  try { await loadDocas(); } catch (err) { alert(err.message); }
});

document.querySelectorAll(".cad-tab").forEach(btn => {
  btn.addEventListener("click", async () => {
    state.cadastroTipo = btn.dataset.tipo;
    document.getElementById("cadastroMsg").textContent = `Tipo atual: ${state.cadastroTipo}`;
    await loadCadastro();
  });
});

document.getElementById("saveCadastro").addEventListener("click", async () => {
  try {
    const payload = JSON.parse(document.getElementById("cadastroJson").value);
    await api(`/api/cadastros/${state.cadastroTipo}`, { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("cadastroMsg").textContent = "Cadastro salvo.";
    await loadCadastro();
    await fillSelects();
  } catch (err) {
    document.getElementById("cadastroMsg").textContent = err.message;
  }
});
document.getElementById("loadCadastro").addEventListener("click", async () => {
  try { await loadCadastro(); } catch (err) { document.getElementById("cadastroMsg").textContent = err.message; }
});

document.getElementById("agendamentoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const data = await api("/api/agendamentos", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("agendamentoMsg").textContent = `Agendamento criado: ${data.protocolo}`;
    await loadAgendamentos();
    await loadDashboard();
    await loadDocas();
  } catch (err) {
    document.getElementById("agendamentoMsg").textContent = err.message;
  }
});

document.getElementById("loadAgendamentos").addEventListener("click", async () => {
  try { await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});

function currentId() {
  const id = document.getElementById("agendamentoId").value;
  if (!id) throw new Error("Informe o ID do agendamento.");
  return id;
}
async function postStatus(path, body = {}) {
  return api(`/api/agendamentos/${currentId()}/${path}`, { method: "POST", body: JSON.stringify(body) });
}
async function handleOp(fn, success) {
  try {
    await fn();
    document.getElementById("operacaoMsg").textContent = success;
    await loadAgendamentos();
    await loadDashboard();
    await loadDocas();
  } catch (err) {
    document.getElementById("operacaoMsg").textContent = err.message;
  }
}
document.getElementById("btnAprovar").onclick = async () => handleOp(() => postStatus("aprovar"), "Agendamento aprovado.");
document.getElementById("btnReprovar").onclick = async () => handleOp(() => postStatus("reprovar", { motivo: "Reprovado via painel" }), "Agendamento reprovado.");
document.getElementById("btnReagendar").onclick = async () => handleOp(() => postStatus("reagendar", {
  dataAgendada: new Date().toISOString().slice(0,10), horaAgendada: "10:00",
  docaId: document.getElementById("internalDocaSelect").value, janelaId: document.getElementById("internalJanelaSelect").value
}), "Agendamento reagendado.");
document.getElementById("btnCancelar").onclick = async () => handleOp(() => postStatus("cancelar", { motivo: "Cancelado via painel" }), "Agendamento cancelado.");
document.getElementById("btnIniciar").onclick = async () => handleOp(() => postStatus("iniciar"), "Descarga iniciada.");
document.getElementById("btnFinalizar").onclick = async () => handleOp(() => postStatus("finalizar"), "Agendamento finalizado.");
document.getElementById("btnNoShow").onclick = async () => handleOp(() => postStatus("no-show"), "Agendamento marcado como no-show.");
document.getElementById("btnVoucher").onclick = () => { try { window.open(`/api/agendamentos/${currentId()}/voucher`, "_blank"); } catch (err) { alert(err.message); } };
document.getElementById("btnQr").onclick = () => { try { window.open(`/api/agendamentos/${currentId()}/qrcode.svg`, "_blank"); } catch (err) { alert(err.message); } };
document.getElementById("btnEnviarInfos").onclick = async () => handleOp(() => api(`/api/agendamentos/${currentId()}/enviar-informacoes`, { method: "POST", body: JSON.stringify({}) }), "Informações enviadas.");

document.getElementById("btnUploadDoc").onclick = async () => {
  try {
    const id = currentId();
    const file = document.getElementById("docFile").files[0];
    if (!file) throw new Error("Selecione um arquivo.");
    const fd = new FormData();
    fd.append("tipoDocumento", "ANEXO");
    fd.append("arquivo", file);
    await api(`/api/agendamentos/${id}/documentos`, { method: "POST", body: fd });
    document.getElementById("operacaoMsg").textContent = "Documento enviado.";
    await loadAgendamentos();
  } catch (err) {
    document.getElementById("operacaoMsg").textContent = err.message;
  }
};

document.getElementById("notaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const id = currentId();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    await api(`/api/agendamentos/${id}/notas`, { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("operacaoMsg").textContent = "NF salva.";
    await loadAgendamentos();
  } catch (err) {
    document.getElementById("operacaoMsg").textContent = err.message;
  }
});

document.getElementById("addNf").addEventListener("click", () => {
  state.nfRows += 1;
  renderNfRows();
});

document.getElementById("fornecedorForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    payload.lgpdConsent = !!e.target.querySelector('[name="lgpdConsent"]').checked;
    payload.notas = collectNotas();
    const data = await api("/api/public/solicitacao", { method: "POST", body: JSON.stringify(payload) });
    document.getElementById("fornecedorMsg").textContent = `Solicitação enviada. Protocolo: ${data.protocolo}. Link motorista: ${data.linkMotorista}`;
  } catch (err) {
    document.getElementById("fornecedorMsg").textContent = err.message;
  }
});

document.getElementById("motoristaConsultaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const token = new FormData(e.target).get("token");
    const data = await api(`/api/public/motorista/${token}`);
    document.getElementById("motoristaResult").textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    document.getElementById("motoristaResult").textContent = err.message;
  }
});

document.getElementById("checkinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  await validateCheckin(new FormData(e.target).get("token"));
});

async function validateCheckin(token) {
  try {
    const data = await api(`/api/public/checkin/${token}`, { method: "POST", body: JSON.stringify({}) });
    document.getElementById("checkinMsg").textContent = data.message;
    document.getElementById("checkinResult").textContent = JSON.stringify(data.agendamento, null, 2);
    if (state.token) {
      await loadDashboard();
      await loadAgendamentos();
      await loadDocas();
    }
  } catch (err) {
    document.getElementById("checkinMsg").textContent = err.message;
  }
}

document.querySelectorAll('input[type="date"]').forEach(el => el.value = new Date().toISOString().slice(0,10));

renderNfRows();
state.role = state.token ? parseJwt(state.token)?.perfil || null : null;
updateNav();

async function scanLoop() {
  if (!("BarcodeDetector" in window) || !state.stream) return;
  const video = document.getElementById("qrVideo");
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  state.detectorTimer = setInterval(async () => {
    try {
      const codes = await detector.detect(video);
      if (codes.length) {
        const raw = codes[0].rawValue || "";
        const url = new URL(raw, window.location.origin);
        const token = url.searchParams.get("token") || raw;
        document.querySelector('#checkinForm input[name="token"]').value = token;
        await validateCheckin(token);
        stopCamera();
      }
    } catch {}
  }, 900);
}
async function startCamera() {
  const video = document.getElementById("qrVideo");
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
  const video = document.getElementById("qrVideo");
  if (video) video.srcObject = null;
}
document.getElementById("startCamera").addEventListener("click", async () => {
  try { await startCamera(); } catch { document.getElementById("checkinMsg").textContent = "Falha ao acessar câmera."; }
});
document.getElementById("stopCamera").addEventListener("click", stopCamera);

const params = new URLSearchParams(location.search);
const view = params.get("view");
const token = params.get("token");
if (view === "checkin") {
  showView("checkin");
  if (token) {
    document.querySelector('#checkinForm input[name="token"]').value = token;
    validateCheckin(token);
  }
}
if (view === "motorista" && token) {
  showView("motorista");
  document.querySelector('#motoristaConsultaForm input[name="token"]').value = token;
  document.getElementById("motoristaConsultaForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
}
if (view === "fornecedor") showView("fornecedor");

if (state.token) {
  fillSelects();
}
