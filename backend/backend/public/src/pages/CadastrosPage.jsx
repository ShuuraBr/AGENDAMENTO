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
  return String(value);
}

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
                        <button type="button" onClick={() => startEdit(item)} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>
                          Editar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
