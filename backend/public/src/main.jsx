import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CadastrosPage from "./pages/CadastrosPage";
import AgendamentosPage from "./pages/AgendamentosPage";
import PublicFornecedorPage from "./pages/PublicFornecedorPage";
import PublicMotoristaPage from "./pages/PublicMotoristaPage";
import PublicConsultaAgendamentoPage from "./pages/PublicConsultaAgendamentoPage";

function Layout({ children }) {
  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 20 }}>
      <h1>Agendamento de Descarga</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <Link to="/">Dashboard</Link>
        <Link to="/cadastros">Cadastros</Link>
        <Link to="/agendamentos">Agendamentos</Link>
        <Link to="/public/fornecedor">Solicitação pública</Link>
        <Link to="/public/consulta-agendamento">Verificação de agendamento</Link>
        <Link to="/public/motorista">Área do motorista</Link>
        <button onClick={() => { localStorage.clear(); location.href = "/login"; }}>Sair</button>
      </nav>
      {children}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/public/fornecedor" element={<PublicFornecedorPage />} />
        <Route path="/public/consulta-agendamento" element={<PublicConsultaAgendamentoPage />} />
        <Route path="/public/motorista" element={<PublicMotoristaPage />} />
        <Route path="/" element={<Layout><DashboardPage /></Layout>} />
        <Route path="/cadastros" element={<Layout><CadastrosPage /></Layout>} />
        <Route path="/agendamentos" element={<Layout><AgendamentosPage /></Layout>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
