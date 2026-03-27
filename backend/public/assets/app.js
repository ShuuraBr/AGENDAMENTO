const state = { token: localStorage.getItem("token") || "" };

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
  } catch (err) {
    document.getElementById("loginMsg").textContent = err.message;
  }
});

document.getElementById("loadDashboard").addEventListener("click", async () => {
  try {
    const data = await api("/api/dashboard/operacional");
    const kpis = document.getElementById("kpis");
    kpis.innerHTML = "";
    Object.entries(data.kpis).forEach(([k, v]) => {
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<strong>${k}</strong><span>${v}</span>`;
      kpis.appendChild(div);
    });
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById("agendamentoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
    const data = await api("/api/agendamentos", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.getElementById("agendamentoMsg").textContent = `Agendamento criado: ${data.protocolo}`;
    document.getElementById("loadAgendamentos").click();
  } catch (err) {
    document.getElementById("agendamentoMsg").textContent = err.message;
  }
});

document.getElementById("loadAgendamentos").addEventListener("click", async () => {
  try {
    const items = await api("/api/agendamentos");
    const wrap = document.getElementById("agendamentosList");
    wrap.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>ID</th><th>Protocolo</th><th>Status</th><th>Fornecedor</th>
            <th>Transportadora</th><th>Data</th><th>Hora</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              <td>${item.id}</td>
              <td>${item.protocolo}</td>
              <td>${item.status}</td>
              <td>${item.fornecedor}</td>
              <td>${item.transportadora}</td>
              <td>${item.dataAgendada}</td>
              <td>${item.horaAgendada}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById("agendamentosList").textContent = err.message;
  }
});

document.getElementById("publicForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = Object.fromEntries(new FormData(e.target).entries());
  try {
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
  const fd = new FormData(e.target);
  try {
    const data = await api(`/api/public/motorista/${fd.get("protocolo")}`);
    document.getElementById("consultaResult").textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    document.getElementById("consultaResult").textContent = err.message;
  }
});

document.querySelectorAll('input[type="date"]').forEach(el => {
  el.value = new Date().toISOString().slice(0, 10);
});
