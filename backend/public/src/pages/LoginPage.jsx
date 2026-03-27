import { useState } from "react";
import { api } from "../services/api";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@local.test");
  const [senha, setSenha] = useState("123456");
  const [erro, setErro] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErro("");
    try {
      const { data } = await api.post("/auth/login", { email, senha });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      location.href = "/";
    } catch (err) {
      setErro(err.response?.data?.message || "Falha no login.");
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f8fafc", fontFamily: "Arial, sans-serif", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 28, boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)" }}>
        <h2 style={{ marginTop: 0, marginBottom: 6, textAlign: "center" }}>Login</h2>
        <p style={{ marginTop: 0, color: "#64748b", textAlign: "center" }}>Acesso ao painel de agendamento de descarga</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>E-mail</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" style={{ padding: 12, borderRadius: 10, border: "1px solid #cbd5e1" }} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Senha</span>
            <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" style={{ padding: 12, borderRadius: 10, border: "1px solid #cbd5e1" }} />
          </label>
          <button type="submit" style={{ padding: 12, borderRadius: 10, cursor: "pointer" }}>Entrar</button>
        </form>
        {erro && <p style={{ color: "#b91c1c", marginBottom: 0 }}>{erro}</p>}
      </div>
    </div>
  );
}
