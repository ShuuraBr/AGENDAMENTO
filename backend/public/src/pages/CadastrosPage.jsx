import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const resources = {
  docas: {
    label: "Docas",
    description: "Cadastre as docas operacionais usadas na aprovação do agendamento.",
    fields: [
      { name: "codigo", label: "Código da doca", placeholder: "Ex.: DOCA 01", required: true },
      { name: "descricao", label: "Descrição", placeholder: "Ex.: Recebimento seco" }
    ]
  },
  janelas: {
    label: "Janelas",
    description: "Cadastre os horários disponíveis. O portal público usa exatamente essas janelas para montar a agenda.",
    fields: [
      { name: "codigo", label: "Horário / código da janela", placeholder: "Ex.: 08:00", required: true },
      { name: "descricao", label: "Descrição", placeholder: "Ex.: Primeira janela da manhã" }
    ]
  },
  fornecedores: {
    label: "Fornecedores",
    description: "Cadastro simplificado para consulta e contato.",
    fields: [
      { name: "nome", label: "Nome / razão social", required: true },
      { name: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
      { name: "email", label: "E-mail" },
      { name: "telefone", label: "Telefone / WhatsApp" }
    ]
  },
  transportadoras: {
    label: "Transportadoras",
    description: "Cadastro da transportadora para contato, confirmação e envio de voucher.",
    fields: [
      { name: "nome", label: "Nome / razão social", required: true },
      { name: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
      { name: "email", label: "E-mail" },
      { name: "telefone", label: "Telefone / WhatsApp" }
    ]
  },
  motoristas: {
    label: "Motoristas",
    description: "Cadastro simples do motorista vinculado à operação.",
    fields: [
      { name: "nome", label: "Nome do motorista", required: true },
      { name: "cpf", label: "CPF" },
      { name: "telefone", label: "Telefone / WhatsApp" },
      { name: "transportadora", label: "Transportadora" }
    ]
  },
  veiculos: {
    label: "Veículos",
    description: "Cadastro do veículo para reaproveitar nos agendamentos.",
    fields: [
      { name: "placa", label: "Placa", required: true },
      { name: "tipo", label: "Tipo de veículo", placeholder: "Ex.: Truck, Carreta" },
      { name: "transportadora", label: "Transportadora" }
    ]
  },
  regras: {
    label: "Regras",
    description: "Parâmetros operacionais usados no processo.",
    fields: [
      { name: "nome", label: "Nome da regra", required: true },
      { name: "toleranciaAtrasoMin", label: "Tolerância de atraso (min)", type: "number" },
      { name: "tempoDescargaPrevistoMin", label: "Tempo previsto de descarga (min)", type: "number" }
    ]
  },
  usuarios: {
    label: "Usuários",
    description: "Cadastro de acesso ao sistema.",
    fields: [
      { name: "nome", label: "Nome", required: true },
      { name: "email", label: "E-mail", required: true, type: "email" },
      {
        name: "perfil",
        label: "Perfil",
        required: true,
        type: "select",
        options: ["ADMIN", "GESTOR", "OPERADOR", "PORTARIA"]
      },
      { name: "senha", label: "Senha", type: "password", helper: "Preencha somente para criar ou trocar a senha." }
    ]
  }
};

const resourceOrder = ["janelas", "docas", "fornecedores", "transportadoras", "motoristas", "veiculos", "regras", "usuarios"];

function buildInitialForm(key) {
  const config = resources[key];
  return config.fields.reduce((acc, field) => {
    acc[field.name] = "";
    return acc;
  }, {});
}

function normalizeValue(field, value) {
  if (field.type === "number") {
    if (value === "" || value === null || typeof value === "undefined") return null;
    return Number(value);
  }
  return String(value ?? "").trim();
}

function prettify(value) {
  if (value === null || typeof value === "undefined" || value === "") return "-";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (Array.isArray(value)) return value.join(", ") || "-";
  return String(value);
}

// ── Vincular fornecedores a uma transportadora ────────────────────────────
function VincularFornecedoresModal({ transportadora, onClose, onSaved }) {
  const [fornecedores, setFornecedores] = useState([]);
  const [allFornecedores, setAllFornecedores] = useState([]);
  const [allTransportadoras, setAllTransportadoras] = useState([]);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setFornecedores(Array.isArray(transportadora?.fornecedoresVinculados) ? transportadora.fornecedoresVinculados : []);
    Promise.all([
      api.get("/cadastros/fornecedores").catch(() => ({ data: [] })),
      api.get("/cadastros/transportadoras").catch(() => ({ data: [] })),
    ]).then(([fRes, tRes]) => {
      setAllFornecedores(Array.isArray(fRes.data) ? fRes.data : []);
      setAllTransportadoras(Array.isArray(tRes.data) ? tRes.data : []);
    });
  }, [transportadora?.id]);

  // Mapa: nome do fornecedor → nome da outra transportadora que já o tem vinculado
  const conflictMap = useMemo(() => {
    const map = {};
    for (const t of allTransportadoras) {
      if (String(t.id) === String(transportadora.id)) continue;
      for (const f of (t.fornecedoresVinculados || [])) {
        map[String(f).trim()] = t.nome || t.razaoSocial || `ID ${t.id}`;
      }
    }
    return map;
  }, [allTransportadoras, transportadora?.id]);

  function add() {
    const name = input.trim();
    if (name && !fornecedores.includes(name)) setFornecedores((f) => [...f, name]);
    setInput("");
  }
  function remove(name) { setFornecedores((f) => f.filter((x) => x !== name)); }

  async function save() {
    setSaving(true); setErr("");
    try {
      await api.post(`/cadastros/transportadoras/${transportadora.id}/vincular-fornecedores`, { fornecedores });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.message || "Erro ao salvar vínculos.");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 18, padding: 24, maxWidth: 500, width: "90%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
        <h3 style={{ margin: "0 0 4px" }}>Vincular fornecedores</h3>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b" }}>
          Transportadora: <strong>{transportadora.nome}</strong>
          <br />Os fornecedores vinculados terão esta transportadora pré-preenchida no agendamento.
        </p>

        {/* Quick-pick from registered suppliers */}
        {allFornecedores.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 600, color: "#374151" }}>Fornecedores cadastrados:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {allFornecedores.map((f) => {
                const name = f.nome || f.name || "";
                const linked = fornecedores.includes(name);
                const conflict = !linked && conflictMap[name];
                return (
                  <button key={f.id} type="button"
                    onClick={() => linked ? remove(name) : setFornecedores((arr) => [...arr, name])}
                    title={conflict ? `⚠️ Já vinculado a: ${conflict}` : ""}
                    style={{
                      padding: "4px 10px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${linked ? "#10b981" : conflict ? "#f59e0b" : "#cbd5e1"}`,
                      background: linked ? "#ecfdf5" : conflict ? "#fffbeb" : "#f8fafc",
                      color: linked ? "#065f46" : conflict ? "#92400e" : "#374151",
                    }}>
                    {linked ? "✓ " : conflict ? "⚠️ " : ""}{name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Manual input */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input
            style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #cbd5e1", fontSize: 13 }}
            placeholder="Adicionar manualmente..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          />
          <button type="button" onClick={add} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #10b981", background: "#ecfdf5", color: "#065f46", cursor: "pointer" }}>+ Add</button>
        </div>

        {/* Current list */}
        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 10, marginBottom: 12 }}>
          {fornecedores.length === 0 && <p style={{ padding: 10, color: "#64748b", fontSize: 13, margin: 0 }}>Nenhum fornecedor vinculado.</p>}
          {fornecedores.map((name) => {
            const conflict = conflictMap[name];
            return (
              <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                <div>
                  <span>{name}</span>
                  {conflict && (
                    <span style={{ marginLeft: 8, fontSize: 11, color: "#f59e0b", fontStyle: "italic" }}>
                      ⚠️ também em: {conflict}
                    </span>
                  )}
                </div>
                <button type="button" onClick={() => remove(name)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>remover</button>
              </div>
            );
          })}
        </div>

        {/* Conflict legend */}
        {fornecedores.some((n) => conflictMap[n]) && (
          <div style={{ padding: "8px 12px", borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", marginBottom: 10, fontSize: 12, color: "#92400e" }}>
            ⚠️ Fornecedores marcados já possuem vínculo com outra transportadora. Você pode salvar assim mesmo — o agendamento usará o vínculo mais recente.
          </div>
        )}

        {err && <p style={{ color: "#ef4444", fontSize: 13 }}>{err}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={save} disabled={saving} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#111827", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
            {saving ? "Salvando..." : "Salvar vínculos"}
          </button>
          <button type="button" onClick={onClose} style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #111827", background: "#fff", cursor: "pointer" }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function CadastrosPage() {
  const [selected, setSelected] = useState("janelas");
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(buildInitialForm("janelas"));
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [vincularModal, setVincularModal] = useState(null); // transportadora object

  const config = resources[selected];

  async function load(resource = selected) {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/cadastros/${resource}`);
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.response?.data?.message || "Não foi possível carregar os cadastros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setForm(buildInitialForm(selected));
    setEditingId(null);
    setMessage("");
    setError("");
    setSearch("");
    load(selected);
  }, [selected]);

  const visibleItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => JSON.stringify(item).toLowerCase().includes(term));
  }, [items, search]);

  function handleChange(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function resetForm() {
    setForm(buildInitialForm(selected));
    setEditingId(null);
  }

  function startEdit(item) {
    const next = buildInitialForm(selected);
    for (const field of config.fields) {
      next[field.name] = item?.[field.name] ?? "";
    }
    setForm(next);
    setEditingId(item.id);
    setMessage("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const payload = {};
      for (const field of config.fields) {
        const normalized = normalizeValue(field, form[field.name]);
        if (field.required && (normalized === "" || normalized === null)) {
          throw new Error(`Preencha o campo ${field.label}.`);
        }
        if (normalized !== "" && normalized !== null) payload[field.name] = normalized;
      }

      if (editingId) {
        await api.put(`/cadastros/${selected}/${editingId}`, payload);
        setMessage(`${config.label.slice(0, -1)} atualizado com sucesso.`);
      } else {
        await api.post(`/cadastros/${selected}`, payload);
        setMessage(`${config.label.slice(0, -1)} cadastrado com sucesso.`);
      }

      resetForm();
      load();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Não foi possível salvar o cadastro.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <h2 style={{ marginBottom: 6 }}>Cadastros</h2>
        <p style={{ marginTop: 0, color: "#555" }}>
          Tela simplificada para cadastrar e atualizar informações sem editar JSON.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {resourceOrder.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSelected(key)}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: key === selected ? "1px solid #1d4ed8" : "1px solid #d0d7de",
              background: key === selected ? "#dbeafe" : "#fff",
              cursor: "pointer"
            }}
          >
            {resources[key].label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 420px) 1fr", gap: 20, alignItems: "start" }}>
        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>{editingId ? `Editar ${config.label.slice(0, -1)}` : `Novo ${config.label.slice(0, -1)}`}</h3>
          <p style={{ color: "#555", marginTop: 0 }}>{config.description}</p>

          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            {config.fields.map((field) => (
              <label key={field.name} style={{ display: "grid", gap: 6 }}>
                <span style={{ fontWeight: 600 }}>{field.label}{field.required ? " *" : ""}</span>
                {field.type === "select" ? (
                  <select
                    value={form[field.name] ?? ""}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
                  >
                    <option value="">Selecione</option>
                    {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                ) : (
                  <input
                    type={field.type || "text"}
                    value={form[field.name] ?? ""}
                    placeholder={field.placeholder || ""}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1" }}
                  />
                )}
                {field.helper && <small style={{ color: "#666" }}>{field.helper}</small>}
              </label>
            ))}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <button type="submit" disabled={saving} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
                {saving ? "Salvando..." : editingId ? "Atualizar cadastro" : "Cadastrar"}
              </button>
              <button type="button" onClick={resetForm} style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer" }}>
                Limpar
              </button>
            </div>
          </form>

          {message && <p style={{ color: "#166534", marginBottom: 0 }}>{message}</p>}
          {error && <p style={{ color: "#b91c1c", marginBottom: 0 }}>{error}</p>}
        </section>

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 16, padding: 18, background: "#fff" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
            <div>
              <h3 style={{ margin: 0 }}>Registros cadastrados</h3>
              <small style={{ color: "#555" }}>Clique em editar para reaproveitar os dados existentes.</small>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nesta lista"
              style={{ padding: 10, borderRadius: 10, border: "1px solid #cbd5e1", minWidth: 220 }}
            />
          </div>

          {loading ? (
            <p>Carregando...</p>
          ) : visibleItems.length === 0 ? (
            <p style={{ color: "#666" }}>Nenhum registro encontrado.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding="10" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                    <th>ID</th>
                    {config.fields.map((field) => <th key={field.name}>{field.label}</th>)}
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td>{item.id}</td>
                      {config.fields.map((field) => <td key={field.name}>{prettify(item[field.name])}</td>)}
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" onClick={() => startEdit(item)} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>
                            Editar
                          </button>
                          {selected === "transportadoras" && (
                            <button
                              type="button"
                              onClick={() => setVincularModal(item)}
                              style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer", border: "1px solid #10b981", background: "#ecfdf5", color: "#065f46", fontSize: 12, fontWeight: 600 }}
                            >
                              🔗 Vincular fornecedores
                              {Array.isArray(item.fornecedoresVinculados) && item.fornecedoresVinculados.length > 0 && (
                                <span style={{ marginLeft: 4, background: "#10b981", color: "#fff", borderRadius: 99, padding: "1px 6px", fontSize: 11 }}>
                                  {item.fornecedoresVinculados.length}
                                </span>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Modal vincular fornecedores — aparece só para transportadoras */}
      {vincularModal && (
        <VincularFornecedoresModal
          transportadora={vincularModal}
          onClose={() => setVincularModal(null)}
          onSaved={() => { load(); setVincularModal(null); setMessage(`Fornecedores vinculados à transportadora "${vincularModal.nome}" atualizados com sucesso.`); }}
        />
      )}
    </div>
  );
}
