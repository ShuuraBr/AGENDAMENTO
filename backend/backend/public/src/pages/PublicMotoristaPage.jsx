import { useState } from "react";
import { api } from "../services/api";

export default function PublicMotoristaPage() {
  const [protocolo, setProtocolo] = useState("");
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState("");

  async function buscar(e) {
    e.preventDefault();
    setErro("");
    setResultado(null);
    try {
      const { data } = await api.get(`/public/motorista/${protocolo}`);
      setResultado(data);
    } catch (err) {
      setErro(err.response?.data?.message || "Protocolo não encontrado.");
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", fontFamily: "Arial" }}>
      <h2>Consulta pública do motorista</h2>
      <form onSubmit={buscar} style={{ display: "flex", gap: 8 }}>
        <input value={protocolo} onChange={(e) => setProtocolo(e.target.value)} placeholder="Digite o protocolo" />
        <button type="submit">Consultar</button>
      </form>

      {erro && <p style={{ color: "red" }}>{erro}</p>}

      {resultado && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
          <p><strong>Protocolo:</strong> {resultado.protocolo}</p>
          <p><strong>Status:</strong> {resultado.status}</p>
          <p><strong>Data:</strong> {new Date(resultado.dataAgendada).toLocaleDateString("pt-BR")}</p>
          <p><strong>Hora:</strong> {resultado.horaAgendada}</p>
          <p><strong>Unidade:</strong> {resultado.unidade}</p>
          <p><strong>Doca:</strong> {resultado.doca}</p>
          <p><strong>Transportadora:</strong> {resultado.transportadora}</p>
          <p><strong>Motorista:</strong> {resultado.motorista}</p>
          <p><strong>Placa:</strong> {resultado.placa}</p>
        </div>
      )}
    </div>
  );
}
