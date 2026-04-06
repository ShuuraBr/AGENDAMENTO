export function DashboardPage() {
  const cards = [
    { label: 'Agendados hoje', value: 0 },
    { label: 'Em andamento', value: 0 },
    { label: 'Concluídos', value: 0 },
    { label: 'No-show', value: 0 }
  ];

  return (
    <div>
      <div className="card">
        <h2>Dashboard Operacional</h2>
        <p>KPIs iniciais do painel interno.</p>
      </div>
      <div className="grid">
        {cards.map((item) => (
          <div className="kpi" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
