import { useState } from "react";
import { api } from "../services/api";

export default function PublicFornecedorPage() {
  const [form, setForm] = useState({
    unidadeId: 1,
    docaId: 1,
    janelaId: 1,
    fornecedorId: 1,
    transportadoraId: 1,
    motoristaId: 1,
    veiculoId: 1,
    dataAgendada: new Date().toISOString().slice(0, 10),
    horaAgendada: "08:00",
    quantidadeNotas: 1,
    quantidadeVolumes: 10,
    pesoTotalKg: 1000,
    origemSolicitacao: "TRANSPORTADORA",
    observacoes: ""
  });
  const [resultado, setResultado] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const { data } = await api.post("/public/solicitacao", form);
    setResultado(data);
  }

  return (
    <div style={{ maxWidth: 900, margin: "20px auto", fontFamily: "Arial" }}>
      <h2>Solicitação pública de agendamento</h2>
      <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {Object.entries(form).map(([key, value]) => (
          <label key={key} style={{ display: "grid", gap: 4 }}>
            <span>{key}</span>
            <input value={value} onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.value }))} />
          </label>
        ))}
        <button type="submit" style={{ gridColumn: "1 / -1" }}>Enviar solicitação</button>
      </form>

      {resultado && (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd" }}>
          <p><strong>Protocolo:</strong> {resultado.protocolo}</p>
          <p><strong>Status:</strong> {resultado.status}</p>
          <p><strong>Avaliação:</strong> {resultado.avaliacao?.motivo}</p>
        </div>
      )}
    </div>
  );
}
