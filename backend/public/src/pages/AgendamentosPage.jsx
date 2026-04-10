import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

function notaKey(nota = {}) {
  return String(nota?.rowHash || `${nota?.fornecedor || ''}::${nota?.numeroNf || ''}::${nota?.serie || ''}`);
}

function sumNotas(notas = [], field = "") {
  return (Array.isArray(notas) ? notas : []).reduce((acc, nota) => acc + Number(nota?.[field] || 0), 0);
}

function formatDateBR(value) {
  if (!value) return "-";
  return new Date(`${value}T00:00:00`).toLocaleDateString("pt-BR");
}

function MultiSelectFornecedores({ options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const selectedLabel = selected.length
    ? `${selected.length} fornecedor(es) selecionado(s)`
    : "Selecione fornecedores";

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => setOpen((old) => !old)}
          style={{
            flex: 1,
            minHeight: 42,
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            textAlign: "left",
            padding: "0 12px",
            cursor: "pointer"
          }}
        >
          {selectedLabel}
        </button>
        <button
          type="button"
          onClick={onClear}
          title="Limpar seleção"
          style={{
            width: 42,
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 700
          }}
        >
          X
        </button>
      </div>

      {open && (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            left: 0,
            right: 0,
            marginTop: 6,
            maxHeight: 280,
            overflow: "auto",
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: 12,
            boxShadow: "0 12px 28px rgba(15, 23, 42, 0.12)",
            padding: 8
          }}
        >
          {options.map((option) => (
            <label
              key={option}
              style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", cursor: "pointer" }}
            >
              <input
                type="checkbox"
                checked={selected.includes(option)}
                onChange={() => onToggle(option)}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgendamentosPage() {
  const [fornecedoresPendentes, setFornecedoresPendentes] = useState([]);
  const [agenda, setAgenda] = useState([]);
  const [docas, setDocas] = useState([]);
  const [items, setItems] = useState([]);
  const [selectedFornecedores, setSelectedFornecedores] = useState([]);
  const [selectedNotas, setSelectedNotas] = useState([]);
  const [selectedDoca, setSelectedDoca] = useState(null);
  const [mensagem, setMensagem] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    dataAgendada: new Date().toISOString().slice(0, 10),
    janelaId: "",
    horaAgendada: "",
    transportadora: "",
    motorista: "",
    telefoneMotorista: "",
    emailMotorista: "",
    emailTransportadora: "",
    placa: "",
    observacoes: ""
  });

  async function loadBase() {
    const [fornecedoresRes, agendaRes, agendamentosRes] = await Promise.all([
      api.get("/public/fornecedores-pendentes"),
      api.get("/public/disponibilidade?dias=21"),
      api.get("/agendamentos")
    ]);
    setFornecedoresPendentes(Array.isArray(fornecedoresRes.data) ? fornecedoresRes.data : []);
    setAgenda(Array.isArray(agendaRes.data?.agenda) ? agendaRes.data.agenda : []);
    setItems(Array.isArray(agendamentosRes.data) ? agendamentosRes.data : []);
  }

  async function loadDocas(dataAgendada) {
    const { data } = await api.get(`/dashboard/docas?dataAgendada=${encodeURIComponent(dataAgendada)}`);
    const lista = Array.isArray(data) ? data : [];
    setDocas(lista);
    setSelectedDoca((current) => lista.find((item) => item.docaId === current?.docaId) || lista[0] || null);
  }

  useEffect(() => {
    loadBase().catch((err) => setErro(err.response?.data?.message || "Falha ao carregar o painel de agendamentos."));
  }, []);

  useEffect(() => {
    if (!form.dataAgendada) return;
    loadDocas(form.dataAgendada).catch((err) => setErro(err.response?.data?.message || "Falha ao carregar o painel de docas."));
  }, [form.dataAgendada]);

  const fornecedoresOptions = useMemo(
    () => fornecedoresPendentes.map((item) => item.fornecedor).filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [fornecedoresPendentes]
  );

  const fornecedoresFiltrados = useMemo(() => {
    if (!selectedFornecedores.length) return fornecedoresPendentes;
    return fornecedoresPendentes.filter((item) => selectedFornecedores.includes(item.fornecedor));
  }, [fornecedoresPendentes, selectedFornecedores]);

  const notasDisponiveis = useMemo(() => {
    return fornecedoresFiltrados.flatMap((grupo) =>
      (Array.isArray(grupo.notas) ? grupo.notas : []).map((nota) => ({
        ...nota,
        fornecedor: grupo.fornecedor,
        transportadora: grupo.transportadora || grupo.fornecedor
      }))
    );
  }, [fornecedoresFiltrados]);

  const agendaSelecionada = useMemo(
    () => agenda.find((item) => item.data === form.dataAgendada) || null,
    [agenda, form.dataAgendada]
  );

  const horariosDisponiveis = useMemo(
    () => (agendaSelecionada?.horarios || []).filter((slot) => Number(slot.disponivel || 0) > 0),
    [agendaSelecionada]
  );

  useEffect(() => {
    const selected = horariosDisponiveis.find((slot) => String(slot.janelaId) === String(form.janelaId));
    const fallback = selected || horariosDisponiveis[0] || null;
    if (!fallback) return;
    setForm((current) => ({
      ...current,
      janelaId: String(fallback.janelaId),
      horaAgendada: String(fallback.hora || "")
    }));
  }, [form.dataAgendada, horariosDisponiveis]);

  const notasSelecionadas = useMemo(
    () => notasDisponiveis.filter((nota) => selectedNotas.includes(notaKey(nota))),
    [notasDisponiveis, selectedNotas]
  );

  const resumoSelecionado = useMemo(() => ({
    quantidadeNotas: notasSelecionadas.length,
    quantidadeVolumes: sumNotas(notasSelecionadas, "volumes"),
    quantidadeItens: sumNotas(notasSelecionadas, "quantidadeItens"),
    pesoTotalKg: sumNotas(notasSelecionadas, "peso"),
    valorTotalNf: sumNotas(notasSelecionadas, "valorNf")
  }), [notasSelecionadas]);

  function toggleFornecedor(nome) {
    setSelectedFornecedores((current) => current.includes(nome)
      ? current.filter((item) => item !== nome)
      : [...current, nome]
    );
  }

  function clearFornecedores() {
    setSelectedFornecedores([]);
    setSelectedNotas([]);
  }

  function toggleNota(nota) {
    const key = notaKey(nota);
    setSelectedNotas((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]
    );
  }

  function buildPayload() {
    if (!notasSelecionadas.length) throw new Error("Selecione ao menos uma nota para agendar.");
    if (!form.dataAgendada) throw new Error("Selecione a data do agendamento.");
    if (!form.janelaId || !form.horaAgendada) throw new Error("Selecione uma janela disponível.");

    const fornecedores = [...new Set(notasSelecionadas.map((nota) => String(nota.fornecedor || "").trim()).filter(Boolean))];
    if (fornecedores.length !== 1) {
      throw new Error("Para salvar um agendamento, selecione notas de um único fornecedor por vez.");
    }

    return {
      fornecedor: fornecedores[0],
      transportadora: form.transportadora || notasSelecionadas[0]?.transportadora || fornecedores[0],
      motorista: form.motorista || "",
      telefoneMotorista: form.telefoneMotorista || "",
      emailMotorista: form.emailMotorista || "",
      emailTransportadora: form.emailTransportadora || "",
      placa: form.placa || "",
      dataAgendada: form.dataAgendada,
      janelaId: Number(form.janelaId),
      horaAgendada: form.horaAgendada,
      observacoes: form.observacoes || "",
      notasFiscais: notasSelecionadas,
      quantidadeNotas: resumoSelecionado.quantidadeNotas,
      quantidadeVolumes: resumoSelecionado.quantidadeVolumes,
      pesoTotalKg: resumoSelecionado.pesoTotalKg,
      valorTotalNf: resumoSelecionado.valorTotalNf
    };
  }

  async function salvarAgendamento() {
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const payload = buildPayload();
      const { data } = await api.post("/agendamentos", payload);
      setMensagem(`Agendamento ${data.protocolo || "criado"} salvo com sucesso.`);
      setSelectedNotas([]);
      await loadBase();
      await loadDocas(form.dataAgendada);
    } catch (err) {
      setErro(err.response?.data?.message || err.message || "Falha ao salvar o agendamento.");
    } finally {
      setSalvando(false);
    }
  }

  async function registrarOcorrencia() {
    setSalvando(true);
    setErro("");
    setMensagem("");
    try {
      const payload = buildPayload();
      const { data } = await api.post("/agendamentos/ocorrencia", {
        fornecedor: payload.fornecedor,
        transportadora: payload.transportadora,
        notas: payload.notasFiscais
      });
      setMensagem(`Ocorrência registrada. ${data.email?.sent ? "E-mail enviado." : "E-mail não enviado."}`);
      setSelectedNotas([]);
      await loadBase();
      await loadDocas(form.dataAgendada);
    } catch (err) {
      setErro(err.response?.data?.message || err.message || "Falha ao registrar a ocorrência.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section style={{ display: "grid", gap: 12, padding: 18, border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff" }}>
        <div>
          <h2 style={{ margin: 0 }}>Agendamentos internos</h2>
          <p style={{ margin: "6px 0 0", color: "#475569" }}>
            Selecione fornecedores pendentes, marque as notas desejadas e monte o agendamento. O painel de docas abaixo mostra as cargas do dia com total de notas, destino, peso, volumes e itens.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1.5fr repeat(2, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Fornecedores pendentes</span>
            <MultiSelectFornecedores
              options={fornecedoresOptions}
              selected={selectedFornecedores}
              onToggle={toggleFornecedor}
              onClear={clearFornecedores}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Data do agendamento</span>
            <input
              type="date"
              value={form.dataAgendada}
              onChange={(e) => setForm((current) => ({ ...current, dataAgendada: e.target.value }))}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span>Janela disponível</span>
            <select
              value={form.janelaId}
              onChange={(e) => {
                const slot = horariosDisponiveis.find((item) => String(item.janelaId) === e.target.value);
                setForm((current) => ({
                  ...current,
                  janelaId: e.target.value,
                  horaAgendada: String(slot?.hora || "")
                }));
              }}
            >
              {horariosDisponiveis.map((slot) => (
                <option key={slot.janelaId} value={slot.janelaId}>
                  {slot.hora} {slot.descricao ? `- ${slot.descricao}` : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(180px, 1fr))", gap: 12 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Transportadora</span>
            <input value={form.transportadora} onChange={(e) => setForm((current) => ({ ...current, transportadora: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Motorista</span>
            <input value={form.motorista} onChange={(e) => setForm((current) => ({ ...current, motorista: e.target.value }))} placeholder="Opcional" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Placa</span>
            <input value={form.placa} onChange={(e) => setForm((current) => ({ ...current, placa: e.target.value.toUpperCase() }))} placeholder="Opcional" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>Telefone do motorista</span>
            <input value={form.telefoneMotorista} onChange={(e) => setForm((current) => ({ ...current, telefoneMotorista: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>E-mail do motorista</span>
            <input type="email" value={form.emailMotorista} onChange={(e) => setForm((current) => ({ ...current, emailMotorista: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <span>E-mail da transportadora</span>
            <input type="email" value={form.emailTransportadora} onChange={(e) => setForm((current) => ({ ...current, emailTransportadora: e.target.value }))} />
          </label>
          <label style={{ display: "grid", gap: 6, gridColumn: "span 2" }}>
            <span>Observações</span>
            <input value={form.observacoes} onChange={(e) => setForm((current) => ({ ...current, observacoes: e.target.value }))} />
          </label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(140px, 1fr))", gap: 12 }}>
          <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong>Notas</strong><div>{resumoSelecionado.quantidadeNotas}</div></div>
          <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong>Volumes</strong><div>{resumoSelecionado.quantidadeVolumes}</div></div>
          <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong>Itens</strong><div>{resumoSelecionado.quantidadeItens}</div></div>
          <div style={{ padding: 12, borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}><strong>Peso</strong><div>{resumoSelecionado.pesoTotalKg.toLocaleString("pt-BR")}</div></div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <button type="button" disabled={salvando} onClick={salvarAgendamento} style={{ minHeight: 44, borderRadius: 12, border: 0, background: "#0f2a4d", color: "#fff", cursor: "pointer" }}>
            Salvar agendamento
          </button>
          <button type="button" disabled={salvando} onClick={registrarOcorrencia} style={{ minHeight: 44, borderRadius: 12, border: "1px solid #b91c1c", background: "#fff5f5", color: "#991b1b", cursor: "pointer" }}>
            Ocorrência
          </button>
        </div>

        {mensagem && <div style={{ padding: 12, borderRadius: 12, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0" }}>{mensagem}</div>}
        {erro && <div style={{ padding: 12, borderRadius: 12, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca" }}>{erro}</div>}
      </section>

      <section style={{ padding: 18, border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Notas pendentes do relatório</h3>
        <div style={{ overflow: "auto" }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th></th>
                <th>Fornecedor</th>
                <th>NF</th>
                <th>Série</th>
                <th>Destino</th>
                <th>Volumes</th>
                <th>Itens</th>
                <th>Peso</th>
              </tr>
            </thead>
            <tbody>
              {notasDisponiveis.map((nota) => {
                const key = notaKey(nota);
                return (
                  <tr key={key} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td>
                      <input type="checkbox" checked={selectedNotas.includes(key)} onChange={() => toggleNota(nota)} />
                    </td>
                    <td>{nota.fornecedor || "-"}</td>
                    <td>{nota.numeroNf || "-"}</td>
                    <td>{nota.serie || "-"}</td>
                    <td>{nota.destino || "-"}</td>
                    <td>{Number(nota.volumes || 0)}</td>
                    <td>{Number(nota.quantidadeItens || 0)}</td>
                    <td>{Number(nota.peso || 0).toLocaleString("pt-BR")}</td>
                  </tr>
                );
              })}
              {!notasDisponiveis.length && (
                <tr>
                  <td colSpan="8" style={{ padding: 12, textAlign: "center", color: "#64748b" }}>Nenhuma nota pendente para os filtros selecionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: 18 }}>
        <div style={{ padding: 18, border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Painel de docas — {formatDateBR(form.dataAgendada)}</h3>
          <div style={{ display: "grid", gap: 10 }}>
            {docas.map((doca) => (
              <button
                key={doca.docaId}
                type="button"
                onClick={() => setSelectedDoca(doca)}
                style={{
                  textAlign: "left",
                  padding: 14,
                  borderRadius: 14,
                  border: selectedDoca?.docaId === doca.docaId ? "2px solid #0f2a4d" : "1px solid #cbd5e1",
                  background: "#fff",
                  cursor: "pointer"
                }}
              >
                <strong>{doca.codigo}</strong>
                <div>Status: {doca.ocupacaoAtual}</div>
                <div>Notas: {doca.totalNotas} | Volumes: {doca.totalVolumes} | Itens: {doca.totalItens}</div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 18, border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Detalhe da doca</h3>
          {!selectedDoca ? (
            <p>Nenhuma doca selecionada.</p>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(120px, 1fr))", gap: 12 }}>
                <div><strong>Doca</strong><div>{selectedDoca.codigo}</div></div>
                <div><strong>Agendamentos</strong><div>{selectedDoca.totalAgendamentos}</div></div>
                <div><strong>Notas</strong><div>{selectedDoca.totalNotas}</div></div>
                <div><strong>Peso</strong><div>{Number(selectedDoca.pesoTotalKg || 0).toLocaleString("pt-BR")}</div></div>
              </div>

              {(selectedDoca.fila || []).map((agendamento) => (
                <div key={agendamento.id} style={{ border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, background: "#f8fafc" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <strong>{agendamento.protocolo || "Sem protocolo"}</strong>
                    <span>{agendamento.status}</span>
                  </div>
                  <div style={{ marginTop: 6, color: "#334155" }}>
                    {agendamento.fornecedor || "-"} • {agendamento.horaAgendada || "-"}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <strong>Resumo:</strong> {agendamento.totalNotas} nota(s), {agendamento.totalVolumes} volume(s), {agendamento.totalItens} item(ns), {Number(agendamento.pesoTotalKg || 0).toLocaleString("pt-BR")} kg
                  </div>
                  <div style={{ overflow: "auto", marginTop: 10 }}>
                    <table width="100%" cellPadding="6" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th>NF</th>
                          <th>Destino</th>
                          <th>Volumes</th>
                          <th>Itens</th>
                          <th>Peso</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(agendamento.notasResumo || []).map((nota) => (
                          <tr key={nota.rowHash || `${nota.numeroNf}-${nota.serie}`} style={{ borderTop: "1px solid #dbe2ea" }}>
                            <td>{nota.numeroNf || "-"}</td>
                            <td>{nota.destino || "-"}</td>
                            <td>{Number(nota.volumes || 0)}</td>
                            <td>{Number(nota.quantidadeItens || 0)}</td>
                            <td>{Number(nota.peso || 0).toLocaleString("pt-BR")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {!selectedDoca?.fila?.length && <p style={{ color: "#64748b" }}>Nenhum agendamento ativo nesta doca para a data selecionada.</p>}
            </div>
          )}
        </div>
      </section>

      <section style={{ padding: 18, border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Últimos agendamentos</h3>
        <div style={{ overflow: "auto" }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                <th>Protocolo</th>
                <th>Status</th>
                <th>Fornecedor</th>
                <th>Data</th>
                <th>Hora</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td>{item.protocolo}</td>
                  <td>{item.status}</td>
                  <td>{item.fornecedor || "-"}</td>
                  <td>{formatDateBR(item.dataAgendada)}</td>
                  <td>{item.horaAgendada || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
