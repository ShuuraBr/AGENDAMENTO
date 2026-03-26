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
    <div style={{ maxWidth: 380, margin: "80px auto", fontFamily: "Arial" }}>
      <h2>Login</h2>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" />
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" />
        <button type="submit">Entrar</button>
      </form>
      {erro && <p style={{ color: "red" }}>{erro}</p>}
    </div>
  );
}
