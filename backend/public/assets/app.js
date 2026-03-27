const state = {
  token: localStorage.getItem("token") || "",
  cadastroTipo: "fornecedores"
};

function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

async function api(url, options = {}) {
  const headers = options.headers || {};
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.message || data || "Erro na requisição");
  return data;
}

function tableFromObjects(items) {
  if (!items?.length) return "<p>Nenhum registro.</p>";
  const cols = Object.keys(items[0]).filter(k => typeof items[0][k] !== "object");
  return `
    <table class="table">
      <thead><tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr></thead>
      <tbody>
        ${items.map(row => `<tr>${cols.map(c => `<td>${row[c] ?? ""}</td>`).join("")}</tr>`).join("")}
      </tbody>
    </table>
  `;
}

async function loadDashboard() {
  const data = await api("/api/dashboard/operacional");
  const kpis = document.getElementById("kpis");
  kpis.innerHTML = "";
  Object.entries(data.kpis).forEach(([k, v]) => {
    const div = document.createElement("div");
    div.className = "kpi";
    div.innerHTML = `<strong>${k}</strong><span>${v}</span>`;
    kpis.appendChild(div);
  });
  document.getElementById("dashboardTable").innerHTML = tableFromObjects(data.agendamentos);
}

async function loadCadastro() {
  const items = await api(`/api/cadastros/${state.cadastroTipo}`);
  document.getElementById("cadastroList").innerHTML = tableFromObjects(items);
}

async function loadAgendamentos() {
  const items = await api("/api/agendamentos");
  document.getElementById("agendamentosList").innerHTML = tableFromObjects(items.map(i => ({
    id: i.id,
    protocolo: i.protocolo,
    status: i.status,
    fornecedor: i.fornecedor,
    transportadora: i.transportadora,
    motorista: i.motorista,
    placa: i.placa,
    doca: i.doca,
    janela: i.janela,
    dataAgendada: i.dataAgendada,
    horaAgendada: i.horaAgendada,
    documentos: i.documentos?.length || 0
  })));
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: fd.get("email"), senha: fd.get("senha") })
    });
    state.token = data.token;
    localStorage.setItem("token", data.token);
    document.getElementById("loginMsg").textContent = `Logado como ${data.user.nome}`;
    showView("dashboard");
    await loadDashboard();
  } catch (err) {
    document.getElementById("loginMsg").textContent = err.message;
  }
});

document.getElementById("loadDashboard").addEventListener("click", async () => {
  try { await loadDashboard(); } catch (err) { alert(err.message); }
});

document.querySelectorAll(".cad-tab").forEach(btn => {
  btn.addEventListener("click", async () => {
    state.cadastroTipo = btn.dataset.tipo;
    document.getElementById("cadastroMsg").textContent = `Tipo atual: ${state.cadastroTipo}`;
    await loadCadastro();
  });
});

document.getElementById("saveCadastro").addEventListener("click", async () => {
  const msg = document.getElementById("cadastroMsg");
  try {
    const payload = JSON.parse(document.getElementById("cadastroJson").value);
    await api(`/api/cadastros/${state.cadastroTipo}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    msg.textContent = "Cadastro salvo.";
    await loadCadastro();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById("loadCadastro").addEventListener("click", async () => {
  try { await loadCadastro(); } catch (err) { document.getElementById("cadastroMsg").textContent = err.message; }
});

document.getElementById("agendamentoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("agendamentoMsg");
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const data = await api("/api/agendamentos", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    msg.textContent = `Agendamento criado: ${data.protocolo}`;
    await loadAgendamentos();
  } catch (err) {
    msg.textContent = err.message;
  }
});

document.getElementById("loadAgendamentos").addEventListener("click", async () => {
  try { await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});

function currentAgendamentoId() {
  return document.getElementById("agendamentoId").value;
}

async function postStatus(path, body = {}) {
  const id = currentAgendamentoId();
  if (!id) throw new Error("Informe o ID do agendamento.");
  return api(`/api/agendamentos/${id}/${path}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

document.getElementById("btnAprovar").addEventListener("click", async () => {
  try { await postStatus("aprovar"); document.getElementById("operacaoMsg").textContent = "Agendamento aprovado."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnReprovar").addEventListener("click", async () => {
  try { await postStatus("reprovar", { motivo: "Reprovado via painel" }); document.getElementById("operacaoMsg").textContent = "Agendamento reprovado."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnReagendar").addEventListener("click", async () => {
  try {
    await postStatus("reagendar", {
      dataAgendada: new Date().toISOString().slice(0, 10),
      horaAgendada: "10:00",
      doca: "DOCA-01",
      janela: "10:00-11:00"
    });
    document.getElementById("operacaoMsg").textContent = "Agendamento reagendado.";
    await loadAgendamentos();
  } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnCancelar").addEventListener("click", async () => {
  try { await postStatus("cancelar", { motivo: "Cancelado via painel" }); document.getElementById("operacaoMsg").textContent = "Agendamento cancelado."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnIniciar").addEventListener("click", async () => {
  try { await postStatus("iniciar"); document.getElementById("operacaoMsg").textContent = "Descarga iniciada."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnFinalizar").addEventListener("click", async () => {
  try { await postStatus("finalizar"); document.getElementById("operacaoMsg").textContent = "Agendamento finalizado."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnNoShow").addEventListener("click", async () => {
  try { await postStatus("no-show"); document.getElementById("operacaoMsg").textContent = "Agendamento marcado como no-show."; await loadAgendamentos(); } catch (err) { document.getElementById("operacaoMsg").textContent = err.message; }
});
document.getElementById("btnVoucher").addEventListener("click", () => {
  const id = currentAgendamentoId();
  if (!id) return alert("Informe o ID do agendamento.");
  window.open(`/api/agendamentos/${id}/voucher`, "_blank");
});
document.getElementById("btnQr").addEventListener("click", () => {
  const id = currentAgendamentoId();
  if (!id) return alert("Informe o ID do agendamento.");
  window.open(`/api/agendamentos/${id}/qrcode.svg`, "_blank");
});

document.getElementById("btnUploadDoc").addEventListener("click", async () => {
  const id = currentAgendamentoId();
  const file = document.getElementById("docFile").files[0];
  if (!id) return alert("Informe o ID do agendamento.");
  if (!file) return alert("Selecione um arquivo.");

  const formData = new FormData();
  formData.append("tipoDocumento", "ANEXO");
  formData.append("arquivo", file);

  try {
    await api(`/api/agendamentos/${id}/documentos`, { method: "POST", body: formData });
    document.getElementById("operacaoMsg").textContent = "Documento enviado.";
    await loadAgendamentos();
  } catch (err) {
    document.getElementById("operacaoMsg").textContent = err.message;
  }
});

document.getElementById("publicForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const payload = Object.fromEntries(new FormData(e.target).entries());
    const data = await api("/api/public/solicitacao", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.getElementById("publicMsg").textContent = `Solicitação enviada. Protocolo: ${data.protocolo}`;
  } catch (err) {
    document.getElementById("publicMsg").textContent = err.message;
  }
});

document.getElementById("consultaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const protocolo = new FormData(e.target).get("protocolo");
    const data = await api(`/api/public/motorista/${protocolo}`);
    document.getElementById("consultaResult").textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    document.getElementById("consultaResult").textContent = err.message;
  }
});

document.getElementById("checkinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const token = new FormData(e.target).get("token");
    const data = await api(`/api/public/checkin/${token}`, { method: "POST", body: JSON.stringify({}) });
    document.getElementById("checkinMsg").textContent = data.message;
    document.getElementById("checkinResult").textContent = JSON.stringify(data.agendamento, null, 2);
  } catch (err) {
    document.getElementById("checkinMsg").textContent = err.message;
  }
});

document.querySelectorAll('input[type="date"]').forEach(el => {
  el.value = new Date().toISOString().slice(0, 10);
});

const params = new URLSearchParams(location.search);
const view = params.get("view");
const token = params.get("token");
if (view === "checkin") {
  showView("checkin");
  if (token) {
    document.querySelector('#checkinForm input[name="token"]').value = token;
    document.getElementById("checkinForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }
}
