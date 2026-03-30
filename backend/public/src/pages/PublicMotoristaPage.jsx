import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../services/api";

function Row({ label, value }) {
  return <div><strong>{label}:</strong> {value || "-"}</div>;
}

export default function PublicMotoristaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  async function buscar(e) {
    e?.preventDefault?.();
    if (!token) {
      setErro("Informe o token do motorista.");
      return;
    }
    setErro("");
    setResultado(null);
    setLoading(true);
    try {
      const { data } = await api.get(`/public/motorista/${token}`);
      setResultado(data);
      setSearchParams({ token });
    } catch (err) {
      setErro(err.response?.data?.message || "Token do motorista não encontrado.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (searchParams.get("token")) buscar();
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: "32px auto", fontFamily: "Arial, sans-serif", padding: "0 16px" }}>
      <h2>Acompanhamento do motorista</h2>
      <p style={{ color: "#475569" }}>Use o token recebido no voucher para consultar o status do agendamento e os dados operacionais liberados.</p>
      <form onSubmit={buscar} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <input style={{ flex: 1, minWidth: 260 }} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Digite o token do motorista" />
        <button type="submit" disabled={loading}>{loading ? "Consultando..." : "Consultar"}</button>
      </form>

      {erro && <p style={{ color: "#b91c1c" }}>{erro}</p>}

      {resultado && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Dados do agendamento</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
              <Row label="Protocolo" value={resultado.protocolo} />
              <Row label="Status" value={resultado.status} />
              <Row label="Semáforo" value={resultado.semaforo} />
              <Row label="Data" value={new Date(`${resultado.dataAgendada}T00:00:00`).toLocaleDateString("pt-BR")} />
              <Row label="Hora" value={resultado.horaAgendada} />
              <Row label="Janela" value={resultado.janela} />
              <Row label="Doca" value={resultado.doca} />
              <Row label="Placa" value={resultado.placa} />
              <Row label="Fornecedor" value={resultado.fornecedor} />
              <Row label="Transportadora" value={resultado.transportadora} />
              <Row label="Motorista" value={resultado.motorista} />
              <Row label="Telefone do motorista" value={resultado.telefoneMotorista} />
            </div>
          </div>

          <div style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
            <h3 style={{ marginTop: 0 }}>Tokens e links</h3>
            <div style={{ display: "grid", gap: 8 }}>
              <Row label="Token do motorista" value={resultado.tokenMotorista} />
              <Row label="Token de check-in" value={resultado.tokenCheckin} />
              <div><strong>Link de check-in:</strong> <a href={resultado.linkCheckin} target="_blank" rel="noreferrer">abrir</a></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
