import { useEffect, useState } from "react";
import { api } from "../services/api";

const endpoints = [
  ["unidades", "Unidades"],
  ["docas", "Docas"],
  ["janelas", "Janelas"],
  ["regras", "Regras"],
  ["fornecedores", "Fornecedores"],
  ["transportadoras", "Transportadoras"],
  ["motoristas", "Motoristas"],
  ["veiculos", "Veículos"]
];

export default function CadastrosPage() {
  const [selected, setSelected] = useState("unidades");
  const [items, setItems] = useState([]);
  const [jsonText, setJsonText] = useState("{}");
  const [msg, setMsg] = useState("");

  async function load(endpoint = selected) {
    const { data } = await api.get(`/${endpoint}`);
    setItems(data);
  }

  useEffect(() => { load(); }, [selected]);

  async function createItem() {
    setMsg("");
    try {
      const payload = JSON.parse(jsonText);
      await api.post(`/${selected}`, payload);
      setMsg("Registro criado.");
      load();
    } catch (err) {
      setMsg(err.response?.data?.message || "Erro ao criar registro.");
    }
  }

  return (
    <div>
      <h2>Cadastros</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {endpoints.map(([value, label]) => (
          <button key={value} onClick={() => setSelected(value)}>{label}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        <div>
          <pre style={{ background: "#f5f5f5", padding: 12, minHeight: 320, overflow: "auto" }}>
            {JSON.stringify(items, null, 2)}
          </pre>
        </div>
        <div>
          <textarea rows="18" style={{ width: "100%" }} value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
          <button onClick={createItem}>Salvar</button>
          {msg && <p>{msg}</p>}
        </div>
      </div>
    </div>
  );
}
