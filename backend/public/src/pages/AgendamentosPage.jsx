import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const initial = {
  docaId: 1,
  janelaId: 1,
  fornecedor: "",
  transportadora: "",
  motorista: "",
  telefoneMotorista: "",
  emailMotorista: "",
  emailTransportadora: "",
  placa: "",
  dataAgendada: new Date().toISOString().slice(0, 10),
  horaAgendada: "08:00",
  quantidadeNotas: 1,
  quantidadeVolumes: 1,
  observacoes: ""
};

const badge = {
  PENDENTE_APROVACAO: { bg: "#fff7ed", color: "#9a3412", label: "Pendente" },
  APROVADO: { bg: "#eff6ff", color: "#1d4ed8", label: "Aprovado" },
  CHEGOU: { bg: "#ecfeff", color: "#0f766e", label: "Chegou" },
  EM_DESCARGA: { bg: "#ecfccb", color: "#3f6212", label: "Em descarga" },
  FINALIZADO: { bg: "#f0fdf4", color: "#166534", label: "Finalizado" },
  CANCELADO: { bg: "#fef2f2", color: "#991b1b", label: "Cancelado" },
  REPROVADO: { bg: "#fef2f2", color: "#991b1b", label: "Reprovado" },
  NO_SHOW: { bg: "#f3f4f6", color: "#374151", label: "No-show" }
};

function StatusPill({ status }) {
  const current = badge[status] || { bg: "#f3f4f6", color: "#111827", label: status };
  return <span style={{ background: current.bg, color: current.color, padding: "6px 10px", borderRadius: 999, fontWeight: 700, fontSize: 12 }}>{current.label}</span>;
}

export default function AgendamentosPage() {
  const [form, setForm] = useState(initial);
  const [items, setItems] = useState([]);
  const [docas, setDocas] = useState([]);
  const [janelas, setJanelas] = useState([]);
  const [mensagem, setMensagem] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [file, setFile] = useState(null);
  const [docaSelection, setDocaSelection] = useState({});

  async function load() {
    const [{ data: ags }, { data: docasData }, { data: janelasData }] = await Promise.all([
      api.get("/agendamentos"),
      api.get("/cadastros/docas"),
      api.get("/cadastros/janelas")
    ]);
    setItems(ags);
    setDocas(docasData);
    setJanelas(janelasData);
    setDocaSelection(Object.fromEntries((ags || []).map((item) => [item.id, String(item.docaId || "")] )));
  }

  useEffect(() => { load(); }, []);

  const janelasOptions = useMemo(() => (janelas || []).map((j) => ({ value: j.id, label: `${j.codigo}${j.descricao ? ` - ${j.descricao}` : ""}` })), [janelas]);

  async function criar(e) {
    e.preventDefault();
    setMensagem("");
    try {
      const { data } = await api.post("/agendamentos", {
        ...form,
        docaId: Number(form.docaId),
        janelaId: Number(form.janelaId),
        quantidadeNotas: Number(form.quantidadeNotas || 0),
        quantidadeVolumes: Number(form.quantidadeVolumes || 0),
        placa: String(form.placa || "").toUpperCase()
      });
      setMensagem(`Criado com status ${data.status}.`);
      setForm(initial);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao criar agendamento.");
    }
  }

  async function aprovar(id) {
    try {
      await api.post(`/agendamentos/${id}/aprovar`, { docaId: Number(docaSelection[id] || 0) || undefined });
      setMensagem(`Agendamento ${id} aprovado.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao aprovar.");
    }
  }

  async function definirDoca(id) {
    try {
      const docaId = Number(docaSelection[id]);
      if (!docaId) {
        setMensagem("Selecione uma doca antes de definir.");
        return;
      }
      await api.post(`/agendamentos/${id}/definir-doca`, { docaId });
      setMensagem(`Doca do agendamento ${id} atualizada.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao definir doca.");
    }
  }

  async function checkin(id) {
    try {
      await api.post(`/agendamentos/${id}/checkin`);
      setMensagem(`Check-in do agendamento ${id} validado.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro no check-in.");
    }
  }

  async function iniciar(id) {
    try {
      await api.post(`/agendamentos/${id}/iniciar`);
      setMensagem(`Descarga do agendamento ${id} iniciada.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao iniciar descarga.");
    }
  }

  async function finalizar(id) {
    try {
      await api.post(`/agendamentos/${id}/finalizar`);
      setMensagem(`Descarga do agendamento ${id} finalizada.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao finalizar descarga.");
    }
  }

  async function reagendar(id) {
    try {
      await api.post(`/agendamentos/${id}/reagendar`, {
        janelaId: Number(form.janelaId),
        docaId: Number(form.docaId),
        dataAgendada: form.dataAgendada,
        horaAgendada: form.horaAgendada,
        motivo: "Reagendamento via painel"
      });
      setMensagem(`Agendamento ${id} reagendado.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao reagendar.");
    }
  }

  async function cancelar(id) {
    try {
      await api.post(`/agendamentos/${id}/cancelar`, { motivo: "Cancelamento via painel" });
      setMensagem(`Agendamento ${id} cancelado.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao cancelar.");
    }
  }

  async function enviarConfirmacao(id) {
    try {
      const { data } = await api.post(`/agendamentos/${id}/enviar-confirmacao`);
      setMensagem(`Confirmação enviada. Token: ${data.tokenVerificacao}.`);
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao enviar confirmação.");
    }
  }

  async function enviarInformacoes(id) {
    try {
      const { data } = await api.post(`/agendamentos/${id}/enviar-informacoes`);
      setMensagem(`Informações enviadas. Token de verificação: ${data.tokenVerificacao}.`);
      load();
    } catch (err) {
      setMensagem(err.response?.data?.message || "Erro ao enviar informações.");
    }
  }

  async function uploadDocumento() {
    if (!selectedId || !file) return;
    const formData = new FormData();
    formData.append("tipoDocumento", "NF");
    formData.append("arquivo", file);
    await api.post(`/agendamentos/${selectedId}/documentos`, formData, { headers: { "Content-Type": "multipart/form-data" } });
    setMensagem("Documento enviado.");
    load();
  }

  function baixarVoucher(id) {
    window.open(`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/agendamentos/${id}/voucher`, "_blank");
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h2>Agendamentos</h2>
        <p style={{ color: "#475569" }}>Nesta tela o operador pode definir a doca, validar check-in, iniciar/finalizar a descarga e controlar os envios de voucher e confirmação.</p>
      </div>

      <form onSubmit={criar} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, background: "#fff", padding: 16, borderRadius: 14, border: "1px solid #e5e7eb" }}>
        <label style={{ display: "grid", gap: 4 }}><span>Fornecedor</span><input value={form.fornecedor} onChange={(e) => setForm((old) => ({ ...old, fornecedor: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Transportadora</span><input value={form.transportadora} onChange={(e) => setForm((old) => ({ ...old, transportadora: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Motorista</span><input value={form.motorista} onChange={(e) => setForm((old) => ({ ...old, motorista: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Telefone</span><input value={form.telefoneMotorista} onChange={(e) => setForm((old) => ({ ...old, telefoneMotorista: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>E-mail motorista</span><input value={form.emailMotorista} onChange={(e) => setForm((old) => ({ ...old, emailMotorista: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>E-mail transportadora</span><input value={form.emailTransportadora} onChange={(e) => setForm((old) => ({ ...old, emailTransportadora: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Placa</span><input value={form.placa} onChange={(e) => setForm((old) => ({ ...old, placa: e.target.value.toUpperCase() }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Data</span><input type="date" value={form.dataAgendada} onChange={(e) => setForm((old) => ({ ...old, dataAgendada: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Hora</span><input type="time" value={form.horaAgendada} onChange={(e) => setForm((old) => ({ ...old, horaAgendada: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Doca</span><select value={form.docaId} onChange={(e) => setForm((old) => ({ ...old, docaId: e.target.value }))}>{docas.map((doca) => <option key={doca.id} value={doca.id}>{doca.codigo}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}><span>Janela</span><select value={form.janelaId} onChange={(e) => setForm((old) => ({ ...old, janelaId: e.target.value }))}>{janelasOptions.map((janela) => <option key={janela.value} value={janela.value}>{janela.label}</option>)}</select></label>
        <label style={{ display: "grid", gap: 4 }}><span>Qtd. notas</span><input type="number" min="0" value={form.quantidadeNotas} onChange={(e) => setForm((old) => ({ ...old, quantidadeNotas: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4 }}><span>Qtd. volumes</span><input type="number" min="0" value={form.quantidadeVolumes} onChange={(e) => setForm((old) => ({ ...old, quantidadeVolumes: e.target.value }))} /></label>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}><span>Observações</span><textarea rows="3" value={form.observacoes} onChange={(e) => setForm((old) => ({ ...old, observacoes: e.target.value }))} /></label>
        <button type="submit" style={{ gridColumn: "1 / -1" }}>Criar agendamento</button>
      </form>

      <div style={{ margin: "4px 0", padding: 12, border: "1px solid #ddd", borderRadius: 12, background: "#fff" }}>
        <h3>Upload de documento</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input placeholder="ID do agendamento" value={selectedId || ""} onChange={(e) => setSelectedId(e.target.value)} />
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <button onClick={uploadDocumento}>Enviar</button>
        </div>
      </div>

      {mensagem && <p style={{ background: "#eff6ff", padding: 12, borderRadius: 12 }}>{mensagem}</p>}

      <div style={{ display: "grid", gap: 16 }}>
        {items.map((item) => (
          <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0 }}>{item.protocolo}</h3>
                <p style={{ margin: "6px 0 0", color: "#475569" }}>{item.fornecedor} • {item.transportadora} • {item.motorista}</p>
              </div>
              <StatusPill status={item.status} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 14 }}>
              <div><strong>Data:</strong> {new Date(`${item.dataAgendada}T00:00:00`).toLocaleDateString("pt-BR")}</div>
              <div><strong>Hora:</strong> {item.horaAgendada}</div>
              <div><strong>Janela:</strong> {item.janela?.codigo || "-"}</div>
              <div><strong>Doca atual:</strong> {item.docaDisplay || item.doca?.codigo || "-"}</div>
              <div><strong>Placa:</strong> {item.placa}</div>
              <div><strong>Semáforo:</strong> {item.semaforo}</div>
              <div><strong>Token verificação:</strong> {item.publicTokenFornecedor}</div>
              <div><strong>Link consulta:</strong> <a href={item.linkConsulta} target="_blank" rel="noreferrer">abrir</a></div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Definir doca para descarga</span>
                  <select value={docaSelection[item.id] || ""} onChange={(e) => setDocaSelection((old) => ({ ...old, [item.id]: e.target.value }))}>
                    <option value="">Selecione</option>
                    {docas.map((doca) => <option key={doca.id} value={doca.id}>{doca.codigo} {doca.descricao ? `- ${doca.descricao}` : ""}</option>)}
                  </select>
                </label>
                <button onClick={() => definirDoca(item.id)}>Salvar doca</button>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignContent: "flex-start" }}>
                <button onClick={() => aprovar(item.id)}>Aprovar</button>
                <button onClick={() => checkin(item.id)}>Check-in</button>
                <button onClick={() => iniciar(item.id)}>Iniciar descarga</button>
                <button onClick={() => finalizar(item.id)}>Finalizar</button>
                <button onClick={() => reagendar(item.id)}>Reagendar</button>
                <button onClick={() => cancelar(item.id)}>Cancelar</button>
                <button onClick={() => enviarInformacoes(item.id)}>Enviar voucher/info</button>
                <button onClick={() => enviarConfirmacao(item.id)}>Enviar confirmação</button>
                <button onClick={() => baixarVoucher(item.id)}>Voucher</button>
              </div>
            </div>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb", display: "grid", gap: 6 }}>
              <div><strong>Notificações:</strong> motorista {item.notificacoes?.voucherMotorista ? "✓" : "✗"} | transportadora/fornecedor {item.notificacoes?.voucherTransportadoraFornecedor ? "✓" : "✗"} | confirmação {item.notificacoes?.confirmacaoTransportadoraFornecedor ? "✓" : "✗"}</div>
              <div><strong>Observações:</strong> {item.observacoes || "-"}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
