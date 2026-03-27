import { useEffect, useState } from "react";
import { api } from "../services/api";

const initial = {
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
  origemSolicitacao: "INTERNO",
  observacoes: ""
};

export default function AgendamentosPage() {
  const [form, setForm] = useState(initial);
  const [items, setItems] = useState([]);
  const [mensagem, setMensagem] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [file, setFile] = useState(null);

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

  async function aprovar(id) {
    await api.post(`/agendamentos/${id}/aprovar`);
    load();
  }

  async function reagendar(id) {
    await api.post(`/agendamentos/${id}/reagendar`, {
      janelaId: 2,
      docaId: 1,
      dataAgendada: new Date().toISOString().slice(0, 10),
      horaAgendada: "09:00",
      motivo: "Reagendamento via painel"
    });
    load();
  }

  async function cancelar(id) {
    await api.post(`/agendamentos/${id}/cancelar`, { motivo: "Cancelamento via painel" });
    load();
  }

  async function enviarConfirmacao(id) {
    const { data } = await api.post(`/agendamentos/${id}/enviar-confirmacao`);
    setMensagem(`Envio processado para o protocolo ${data.protocolo}.`);
  }

  async function uploadDocumento() {
    if (!selectedId || !file) return;
    const formData = new FormData();
    formData.append("tipoDocumento", "NF");
    formData.append("arquivo", file);
    await api.post(`/agendamentos/${selectedId}/documentos`, formData, {
      headers: { "Content-Type": "multipart/form-data" }
    });
    setMensagem("Documento enviado.");
    load();
  }

  function baixarVoucher(id) {
    window.open(`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/agendamentos/${id}/voucher`, "_blank");
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

      <div style={{ margin: "16px 0", padding: 12, border: "1px solid #ddd" }}>
        <h3>Upload de documento</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input placeholder="ID do agendamento" value={selectedId || ""} onChange={(e) => setSelectedId(e.target.value)} />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button onClick={uploadDocumento}>Enviar</button>
        </div>
      </div>

      {mensagem && <p>{mensagem}</p>}

      <table width="100%" border="1" cellPadding="8" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Protocolo</th>
            <th>Status</th>
            <th>Data</th>
            <th>Hora</th>
            <th>Docs</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.id}</td>
              <td>{item.protocolo}</td>
              <td>{item.status}</td>
              <td>{new Date(item.dataAgendada).toLocaleDateString("pt-BR")}</td>
              <td>{item.horaAgendada}</td>
              <td>{item.documentos?.length || 0}</td>
              <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={() => aprovar(item.id)}>Aprovar</button>
                <button onClick={() => reagendar(item.id)}>Reagendar</button>
                <button onClick={() => cancelar(item.id)}>Cancelar</button>
                <button onClick={() => enviarConfirmacao(item.id)}>Enviar confirmação</button>
                <button onClick={() => baixarVoucher(item.id)}>Voucher</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
