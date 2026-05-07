import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CadastrosPage from "./pages/CadastrosPage";
import AgendamentosPage from "./pages/AgendamentosPage";
import PublicFornecedorPage from "./pages/PublicFornecedorPage";
import PublicMotoristaPage from "./pages/PublicMotoristaPage";

// ── JWT helpers ──────────────────────────────────────────────────────────────
function parseJwt(token) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

function getLoggedUser() {
  const token = localStorage.getItem("token");
  if (!token) return null;
  return parseJwt(token);
}

// ── Watermark ────────────────────────────────────────────────────────────────
function Watermark({ user }) {
  if (!user) return null;
  const email = user.email || user.nome || user.sub || "";
  const label = email;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      {/* grid of repeating diagonal tiles */}
      {Array.from({ length: 60 }).map((_, i) => {
        const col = i % 6;
        const row = Math.floor(i / 6);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${col * 18}%`,
              top: `${row * 14}%`,
              transform: "rotate(-30deg)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              opacity: 0.055,
              userSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            <img
              src="/assets/Favicon.png"
              alt=""
              style={{ width: 26, height: 26, objectFit: "contain" }}
            />
            <span
              style={{
                fontSize: 9, fontWeight: 700, color: "#0f172a",
                letterSpacing: "0.04em", fontFamily: "Arial, sans-serif",
              }}
            >
              {label}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#0f172a",
                letterSpacing: "0.04em",
                fontFamily: "Arial, sans-serif",
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Nav link ─────────────────────────────────────────────────────────────────
function NavLink({ to, children }) {
  const location = useLocation();
  const active = location.pathname === to || (to !== "/" && location.pathname.startsWith(to));
  return (
    <Link
      to={to}
      style={{
        padding: "8px 16px",
        borderRadius: 10,
        textDecoration: "none",
        fontSize: 14,
        fontWeight: 600,
        background: active ? "#0f172a" : "transparent",
        color: active ? "#fff" : "#334155",
        border: `1px solid ${active ? "#0f172a" : "#e2e8f0"}`,
        transition: "all .15s",
      }}
    >
      {children}
    </Link>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────
function Layout({ children }) {
  const [user, setUser] = useState(getLoggedUser);

  useEffect(() => {
    const refresh = () => setUser(getLoggedUser());
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);

  const token = localStorage.getItem("token");
  if (!token) return <Navigate to="/login" replace />;

  function handleLogout() {
    localStorage.clear();
    window.location.href = "/login";
  }

  return (
    <div style={{ fontFamily: "Arial, sans-serif", minHeight: "100vh", background: "#f8fafc" }}>
      {/* Watermark behind everything */}
      <Watermark user={user} />

      {/* Top nav */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          background: "#fff",
          borderBottom: "1px solid #e2e8f0",
          padding: "10px 24px",
          display: "flex",
          alignItems: "center",
          gap: 16,
          boxShadow: "0 1px 8px rgba(15,23,42,0.06)",
        }}
      >
        <img src="/assets/Favicon.png" alt="Logo" style={{ width: 32, height: 32, objectFit: "contain" }} />
        <span style={{ fontWeight: 800, fontSize: 16, color: "#0f172a", marginRight: 8 }}>
          Agendamento
        </span>

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: 1 }}>
          <NavLink to="/">Dashboard</NavLink>
          <NavLink to="/agendamentos">Agendamentos</NavLink>
          <NavLink to="/cadastros">Cadastros</NavLink>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#475569" }}>
          {user && (
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.3 }}>
              <strong style={{ color: "#0f172a", fontSize: 13 }}>{user.nome || user.email || ""}</strong>
              <span style={{ fontSize: 11, color: "#94a3b8" }}>{user.email || ""}</span>
            </span>
          )}
          <button
            onClick={handleLogout}
            style={{
              padding: "7px 14px",
              borderRadius: 8,
              border: "1px solid #fca5a5",
              background: "#fef2f2",
              color: "#b91c1c",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Sair
          </button>
        </div>
      </header>

      <main style={{ padding: 24 }}>{children}</main>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/public/fornecedor" element={<PublicFornecedorPage />} />
        <Route path="/public/motorista" element={<PublicMotoristaPage />} />
        <Route path="/" element={<Layout><DashboardPage /></Layout>} />
        <Route path="/cadastros" element={<Layout><CadastrosPage /></Layout>} />
        <Route path="/agendamentos" element={<Layout><AgendamentosPage /></Layout>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
