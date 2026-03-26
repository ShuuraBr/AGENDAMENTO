import { useEffect, useState } from "react";
import { api } from "../services/api";

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/dashboard/operacional").then((res) => setData(res.data));
  }, []);

  if (!data) return <p>Carregando...</p>;

  return (
    <div>
      <h2>Painel Operacional</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
        {Object.entries(data.kpis).map(([k, v]) => (
          <div key={k} style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}>
            <strong>{k}</strong>
            <div style={{ fontSize: 28 }}>{v}</div>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>Janelas do dia</h3>
      <table width="100%" border="1" cellPadding="8" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>ID</th>
            <th>Hora início</th>
            <th>Hora fim</th>
            <th>Capacidade</th>
            <th>Ocupada</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.janelasHoje.map((j) => (
            <tr key={j.id}>
              <td>{j.id}</td>
              <td>{j.horaInicio}</td>
              <td>{j.horaFim}</td>
              <td>{j.capacidadeMaxima}</td>
              <td>{j.capacidadeOcupada}</td>
              <td>{j.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
