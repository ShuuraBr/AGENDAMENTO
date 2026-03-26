import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CadastrosPage from "./pages/CadastrosPage";
import AgendamentosPage from "./pages/AgendamentosPage";

function Layout({ children }) {
  if (!localStorage.getItem("token")) return <Navigate to="/login" replace />;
  return (
    <div style={{ fontFamily: "Arial, sans-serif", padding: 20 }}>
      <h1>Agendamento de Descarga</h1>
      <nav style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <Link to="/">Dashboard</Link>
        <Link to="/cadastros">Cadastros</Link>
        <Link to="/agendamentos">Agendamentos</Link>
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
        <Route path="/" element={<Layout><DashboardPage /></Layout>} />
        <Route path="/cadastros" element={<Layout><CadastrosPage /></Layout>} />
        <Route path="/agendamentos" element={<Layout><AgendamentosPage /></Layout>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
