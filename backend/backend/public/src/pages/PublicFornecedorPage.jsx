import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const emptyNota = () => ({ numeroNf: "", serie: "", chaveAcesso: "", volumes: "", peso: "", valorNf: "", observacao: "" });

export default function PublicFornecedorPage() {
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);
  const [form, setForm] = useState({
    fornecedor: "",
    transportadora: "",
    motorista: "",
    telefoneMotorista: "",
    emailMotorista: "",
    emailTransportadora: "",
    placa: "",
    dataAgendada: "",
    janelaId: "",
    horaAgendada: "",
    quantidadeVolumes: "",
    observacoes: "",
    lgpdConsent: false,
    notas: [emptyNota()]
  });

  async function loadAvailability() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/public/disponibilidade?dias=21");
      const agenda = Array.isArray(data?.agenda) ? data.agenda : [];
      setAvailability(agenda);

      const firstDay = agenda.find((day) => day.disponivel && day.horarios?.some((slot) => slot.disponivel));
      if (firstDay) {
        const firstSlot = firstDay.horarios.find((slot) => slot.disponivel);
        setForm((current) => ({
          ...current,
          dataAgendada: current.dataAgendada || firstDay.data,
          janelaId: current.janelaId || String(firstSlot?.janelaId || ""),
          horaAgendada: current.horaAgendada || String(firstSlot?.hora || "")
        }));
      }
    } catch (err) {
      setError(err.response?.data?.message || "Não foi possível carregar os horários disponíveis.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAvailability();
  }, []);

  const availableDays = useMemo(
    () => availability.filter((day) => day.disponivel && day.horarios?.some((slot) => slot.disponivel)),
    [availability]
  );

  const selectedDay = useMemo(
    () => availableDays.find((day) => day.data === form.dataAgendada) || null,
    [availableDays, form.dataAgendada]
  );

  const availableSlots = useMemo(
    () => (selectedDay?.horarios || []).filter((slot) => slot.disponivel),
    [selectedDay]
  );

  useEffect(() => {
    if (!selectedDay) return;
    const stillExists = availableSlots.find((slot) => String(slot.janelaId) === String(form.janelaId));
    const chosen = stillExists || availableSlots[0];
    if (!chosen) return;
    setForm((current) => ({
      ...current,
      janelaId: String(chosen.janelaId),
      horaAgendada: String(chosen.hora || chosen.codigo || "")
    }));
  }, [form.dataAgendada, selectedDay, availableSlots]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateNota(index, name, value) {
    setForm((current) => ({
      ...current,
      notas: current.notas.map((nota, idx) => idx === index ? { ...nota, [name]: value } : nota)
    }));
  }

  function addNota() {
    setForm((current) => ({ ...current, notas: [...current.notas, emptyNota()] }));
  }

  function removeNota(index) {
    setForm((current) => ({
      ...current,
      notas: current.notas.length === 1 ? [emptyNota()] : current.notas.filter((_, idx) => idx !== index)
    }));
  }

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError("");
    setResultado(null);
    try {
      const payload = {
        ...form,
        janelaId: Number(form.janelaId),
        horaAgendada: form.horaAgendada,
        quantidadeVolumes: Number(form.quantidadeVolumes || 0),
        notas: form.notas
      };
      const { data } = await api.post("/public/solicitacao", payload);
      setResultado(data);
      setForm((current) => ({
        ...current,
        motorista: "",
        telefoneMotorista: "",
        emailMotorista: "",
        placa: "",
        quantidadeVolumes: "",
        observacoes: "",
        notas: [emptyNota()],
        lgpdConsent: false
      }));
      loadAvailability();
    } catch (err) {
      setError(err.response?.data?.message || "Não foi possível enviar a solicitação.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "24px auto", fontFamily: "Arial, sans-serif", padding: "0 16px" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 6 }}>Solicitação de agendamento</h2>
        <p style={{ marginTop: 0, color: "#555" }}>
          A transportadora ou fornecedor escolhe apenas a data e o horário disponíveis. A doca será definida pelo operador do recebimento.
        </p>
      </div>

      <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Contato da operação</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Fornecedor *</span>
              <input value={form.fornecedor} onChange={(e) => updateField("fornecedor", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Transportadora *</span>
              <input value={form.transportadora} onChange={(e) => updateField("transportadora", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Motorista *</span>
              <input value={form.motorista} onChange={(e) => updateField("motorista", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Telefone do motorista</span>
              <input value={form.telefoneMotorista} onChange={(e) => updateField("telefoneMotorista", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>E-mail do motorista</span>
              <input type="email" value={form.emailMotorista} onChange={(e) => updateField("emailMotorista", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>E-mail da transportadora/fornecedor</span>
              <input type="email" value={form.emailTransportadora} onChange={(e) => updateField("emailTransportadora", e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Placa do veículo *</span>
              <input value={form.placa} onChange={(e) => updateField("placa", e.target.value.toUpperCase())} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>Quantidade de volumes</span>
              <input type="number" min="0" value={form.quantidadeVolumes} onChange={(e) => updateField("quantidadeVolumes", e.target.value)} />
            </label>
          </div>
        </section>

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Data e horário disponíveis</h3>
          {loading ? (
            <p>Carregando janelas do banco...</p>
          ) : availableDays.length === 0 ? (
            <p style={{ color: "#b91c1c" }}>Não há dias disponíveis no momento.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Dia disponível *</span>
                <select value={form.dataAgendada} onChange={(e) => updateField("dataAgendada", e.target.value)}>
                  {availableDays.map((day) => (
                    <option key={day.data} value={day.data}>{new Date(`${day.data}T00:00:00`).toLocaleDateString("pt-BR")}</option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Horário disponível (janela) *</span>
                <select
                  value={form.janelaId}
                  onChange={(e) => {
                    const slot = availableSlots.find((item) => String(item.janelaId) === e.target.value);
                    updateField("janelaId", e.target.value);
                    updateField("horaAgendada", slot?.hora || slot?.codigo || "");
                  }}
                >
                  {availableSlots.map((slot) => (
                    <option key={slot.janelaId} value={slot.janelaId}>
                      {slot.hora || slot.codigo} {slot.descricao ? `- ${slot.descricao}` : ""} ({slot.capacidade - slot.ocupados} vaga(s))
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ alignSelf: "end", background: "#f8fafc", borderRadius: 12, padding: 12, border: "1px solid #e2e8f0" }}>
                <strong>Observação:</strong> a doca não é escolhida aqui. O operador define a doca no momento da análise/aprovação.
              </div>
            </div>
          )}
        </section>

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0 }}>Notas fiscais</h3>
            <button type="button" onClick={addNota} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
              Adicionar NF
            </button>
          </div>

          <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
            {form.notas.map((nota, index) => (
              <div key={index} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 14, background: "#fcfcfd" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <strong>NF {index + 1}</strong>
                  <button type="button" onClick={() => removeNota(index)} style={{ borderRadius: 8, cursor: "pointer" }}>
                    Remover
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Número da NF</span>
                    <input value={nota.numeroNf} onChange={(e) => updateNota(index, "numeroNf", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Série</span>
                    <input value={nota.serie} onChange={(e) => updateNota(index, "serie", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Chave de acesso</span>
                    <input value={nota.chaveAcesso} onChange={(e) => updateNota(index, "chaveAcesso", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Volumes</span>
                    <input type="number" min="0" value={nota.volumes} onChange={(e) => updateNota(index, "volumes", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Peso</span>
                    <input type="number" min="0" step="0.01" value={nota.peso} onChange={(e) => updateNota(index, "peso", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6 }}>
                    <span>Valor da NF</span>
                    <input type="number" min="0" step="0.01" value={nota.valorNf} onChange={(e) => updateNota(index, "valorNf", e.target.value)} />
                  </label>
                  <label style={{ display: "grid", gap: 6, gridColumn: "1 / -1" }}>
                    <span>Observação</span>
                    <input value={nota.observacao} onChange={(e) => updateNota(index, "observacao", e.target.value)} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Observações finais</h3>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Observações</span>
            <textarea rows="4" value={form.observacoes} onChange={(e) => updateField("observacoes", e.target.value)} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
            <input type="checkbox" checked={form.lgpdConsent} onChange={(e) => updateField("lgpdConsent", e.target.checked)} />
            <span>Autorizo o uso dos dados para o processo de agendamento e recebimento.</span>
          </label>
        </section>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <button type="submit" disabled={sending || loading || availableDays.length === 0} style={{ padding: "12px 18px", borderRadius: 10, cursor: "pointer" }}>
            {sending ? "Enviando..." : "Enviar solicitação"}
          </button>
          {error && <span style={{ color: "#b91c1c" }}>{error}</span>}
        </div>
      </form>

      {resultado && (
        <div style={{ marginTop: 20, padding: 16, border: "1px solid #d1fae5", borderRadius: 14, background: "#ecfdf5" }}>
          <p><strong>Protocolo:</strong> {resultado.protocolo}</p>
          <p><strong>Status:</strong> {resultado.status}</p>
          <p>Solicitação registrada com sucesso. O operador fará a definição da doca e a aprovação conforme disponibilidade operacional.</p>
        </div>
      )}
    </div>
  );
}
