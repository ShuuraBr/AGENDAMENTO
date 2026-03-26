import { useEffect, useState } from "react";
import { api } from "../services/api";

const initial = {
  unidadeId: 1, docaId: 1, janelaId: 1, fornecedorId: 1, transportadoraId: 1,
  motoristaId: 1, veiculoId: 1, dataAgendada: new Date().toISOString().slice(0,10),
  horaAgendada: "08:00", quantidadeNotas: 1, quantidadeVolumes: 10, pesoTotalKg: 1000,
  origemSolicitacao: "INTERNO", observacoes: ""
};

export default function AgendamentosPage() {
  const [form, setForm] = useState(initial);
  const [items, setItems] = useState([]);
  const [mensagem, setMensagem] = useState("");

  async function load() {
    const { data } = await api.get("/agendamentos");
    setItems(data);
  }
  useEffect(() => { load(); }, []);

  async function criar(e) {
    e.preventDefault();
    setMensagem("");
    try {
      const { data } = await api.post("/agendamentos", form);
      setMensagem(`Criado com status ${data.status}. ${data.avaliacao?.motivo || ""}`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao criar agendamento.");
    }
  }

  async function aprovar(id) { await api.post(`/agendamentos/${id}/aprovar`); load(); }
  async function cancelar(id) { await api.post(`/agendamentos/${id}/cancelar`, { motivo: "Cancelamento via painel" }); load(); }
  async function reagendar(id) {
    await api.post(`/agendamentos/${id}/reagendar`, {
      janelaId: 2, docaId: 1, dataAgendada: new Date().toISOString().slice(0,10),
      horaAgendada: "09:00", motivo: "Reagendamento via painel"
    });
    load();
  }

  return (
    <div>
      <h2>Agendamentos</h2>
      <form onSubmit={criar} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {Object.entries(form).map(([key, value]) => (
          <label key={key} style={{ display: "grid", gap: 4 }}>
            <span>{key}</span>
            <input value={value} onChange={(e) => setForm((old) => ({ ...old, [key]: e.target.value }))} />
          </label>
        ))}
        <button type="submit" style={{ gridColumn: "1 / -1" }}>Criar agendamento</button>
      </form>
      {mensagem && <p>{mensagem}</p>}

      <h3>Lista</h3>
      <table width="100%" border="1" cellPadding="8" style={{ borderCollapse: "collapse" }}>
        <thead><tr><th>ID</th><th>Protocolo</th><th>Status</th><th>Data</th><th>Hora</th><th>Fornecedor</th><th>Transportadora</th><th>Ações</th></tr></thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.id}</td><td>{item.protocolo}</td><td>{item.status}</td>
              <td>{new Date(item.dataAgendada).toLocaleDateString("pt-BR")}</td><td>{item.horaAgendada}</td>
              <td>{item.fornecedor?.razaoSocial || "-"}</td><td>{item.transportadora?.razaoSocial || "-"}</td>
              <td style={{ display: "flex", gap: 8 }}>
                <button onClick={() => aprovar(item.id)}>Aprovar</button>
                <button onClick={() => reagendar(item.id)}>Reagendar</button>
                <button onClick={() => cancelar(item.id)}>Cancelar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
