import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/dashboard/operacional').then((res) => setData(res.data));
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <h1>Painel Operacional</h1>
      <p><Link to="/agendamentos">Ir para agendamentos</Link></p>
      {data ? (
        <div>
          <p>Agendados hoje: {data.agendadosHoje}</p>
          <p>Pendentes: {data.pendentes}</p>
          <p>Aprovados: {data.aprovados}</p>
          <p>Em descarga: {data.emDescarga}</p>
          <p>Finalizados: {data.finalizados}</p>
        </div>
      ) : <p>Carregando...</p>}
    </div>
  );
}
