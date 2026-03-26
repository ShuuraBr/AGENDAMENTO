import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import api from '../services/api.js';

export default function DashboardPage() {
  const [data, setData] = useState(null);

  useEffect(() => { api.get('/dashboard/operacional').then((res) => setData(res.data)); }, []);

  const kpis = data?.kpis || {};

  return (
    <Layout>
      <div className='page-title'><div><h2>Dashboard Operacional</h2><div className='muted'>Indicadores do dia e pendências do MVP</div></div></div>

      <div className='grid grid-4'>
        {[
          ['Total', kpis.total || 0],
          ['Pendentes', kpis.pendentesAprovacao || 0],
          ['Aprovados', kpis.aprovados || 0],
          ['Em descarga', kpis.emDescarga || 0],
          ['Finalizados', kpis.finalizados || 0],
          ['No-show', kpis.noShow || 0],
          ['Com docs', kpis.comDocumentos || 0],
        ].map(([label, value]) => <div className='card' key={label}><div className='muted'>{label}</div><div className='kpi-value'>{value}</div></div>)}
      </div>

      <div className='card' style={{ marginTop: 16 }}>
        <h3>Operação do dia</h3>
        <table className='table'><thead><tr><th>Protocolo</th><th>Hora</th><th>Status</th><th>Fornecedor</th><th>Transportadora</th><th>Motorista</th><th>Doca</th><th>Docs</th></tr></thead><tbody>{(data?.agendamentos || []).map((item) => <tr key={item.id.toString()}><td>{item.protocolo}</td><td>{new Date(item.horaAgendada).toISOString().slice(11, 16)}</td><td><span className='badge'>{item.status}</span></td><td>{item.fornecedor?.razaoSocial || '-'}</td><td>{item.transportadora?.razaoSocial || '-'}</td><td>{item.motorista?.nome || '-'}</td><td>{item.doca?.codigo || '-'}</td><td>{item.documentos?.length || 0}</td></tr>)}</tbody></table>
      </div>
    </Layout>
  );
}
