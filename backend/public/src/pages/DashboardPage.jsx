import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

const STATUS_COLORS = {
  PENDENTE_APROVACAO: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'Pendente' },
  APROVADO:          { bg: '#ecfdf5', border: '#10b981', text: '#065f46', label: 'Aprovado' },
  CANCELADO:         { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', label: 'Cancelado' },
  NO_SHOW:           { bg: '#f5f3ff', border: '#8b5cf6', text: '#5b21b6', label: 'No-show' },
  REAGENDADO:        { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', label: 'Reagendado' },
  FINALIZADO:        { bg: '#f8fafc', border: '#64748b', text: '#334155', label: 'Finalizado' },
  CHEGOU:            { bg: '#ecfeff', border: '#06b6d4', text: '#155e75', label: 'Chegou' },
  EM_DESCARGA:       { bg: '#fff7ed', border: '#f97316', text: '#9a3412', label: 'Em descarga' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_COLORS[status] || { bg: '#f1f5f9', border: '#cbd5e1', text: '#475569', label: status };
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 600,
      background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.text,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function KpiCard({ label, value, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'grid', gap: 4, textAlign: 'left', padding: '14px 18px',
      borderRadius: 14, border: `2px solid ${active ? color : color + '40'}`,
      background: active ? color + '22' : color + '10',
      cursor: 'pointer', transition: 'all .15s',
    }}>
      <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 700, color }}>{value ?? 0}</span>
    </button>
  );
}

const KPI_DEFS = [
  { key: 'pendentes',   label: 'Pendentes',   color: '#f59e0b', status: 'PENDENTE_APROVACAO' },
  { key: 'aprovados',   label: 'Aprovados',   color: '#10b981', status: 'APROVADO' },
  { key: 'chegou',      label: 'Chegou',      color: '#06b6d4', status: 'CHEGOU' },
  { key: 'emDescarga',  label: 'Em descarga', color: '#f97316', status: 'EM_DESCARGA' },
  { key: 'finalizados', label: 'Finalizados', color: '#64748b', status: 'FINALIZADO' },
  { key: 'cancelados',  label: 'Cancelados',  color: '#ef4444', status: 'CANCELADO' },
  { key: 'noShow',      label: 'No-show',     color: '#8b5cf6', status: 'NO_SHOW' },
];

export default function DashboardPage() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [tableFilter, setTableFilter] = useState({ protocolo: '', data: todayStr, fornecedor: '', transportadora: '', nf: '' });

  async function load(dataFiltro = tableFilter.data || todayStr) {
    setLoading(true); setError('');
    try {
      const res = await api.get('/dashboard/operacional', { params: { dataAgendada: dataFiltro } });
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Erro ao carregar dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(todayStr); }, []);

  const agendamentos = useMemo(() => {
    if (!data?.agendamentos) return [];
    let list = [...data.agendamentos];
    if (statusFilter) list = list.filter((a) => a.status === statusFilter);
    const norm = (s) => String(s || '').toLowerCase();
    if (tableFilter.protocolo) list = list.filter((a) => norm(a.protocolo).includes(norm(tableFilter.protocolo)));
    if (tableFilter.fornecedor) list = list.filter((a) => norm(a.fornecedor).includes(norm(tableFilter.fornecedor)));
    if (tableFilter.transportadora) list = list.filter((a) => norm(a.transportadora).includes(norm(tableFilter.transportadora)));
    if (tableFilter.nf) list = list.filter((a) => (a.notasFiscais || []).some((nf) => norm(nf.numeroNf).includes(norm(tableFilter.nf))));
    return list;
  }, [data, statusFilter, tableFilter]);

  function toggleFilter(status) {
    setStatusFilter((cur) => (cur === status ? null : status));
  }

  return (
    <div style={{ padding: 24, display: 'grid', gap: 20, background: '#f8fafc', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26 }}>Painel Operacional</h1>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 14 }}>
            Visão geral dos agendamentos e KPIs.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <Link to="/agendamentos" style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #111827', background: '#111827', color: '#fff', fontWeight: 600, textDecoration: 'none', fontSize: 13 }}>
            + Novo agendamento
          </Link>
          <button type="button" onClick={load} disabled={loading} style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13 }}>
            ↺ Atualizar
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, borderRadius: 10, background: '#fef2f2', border: '1px solid #ef4444', color: '#991b1b' }}>{error}</div>
      )}

      {/* KPI Cards */}
      {!loading && data?.kpis && (
        <div>
          <h2 style={{ margin: '0 0 10px', fontSize: 16, color: '#374151' }}>KPIs — clique para filtrar</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
            {KPI_DEFS.map(({ key, label, color, status }) => (
              <KpiCard
                key={key}
                label={label}
                value={data.kpis[key] ?? 0}
                color={color}
                active={statusFilter === status}
                onClick={() => toggleFilter(status)}
              />
            ))}
            <div style={{ display: 'grid', gap: 4, padding: '14px 18px', borderRadius: 14, border: '2px solid #0ea5e930', background: '#0ea5e910' }}>
              <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#0ea5e9' }}>{data.kpis.total ?? 0}</span>
            </div>
          </div>
          {statusFilter && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#475569' }}>
              Filtrando: <strong>{KPI_DEFS.find((d) => d.status === statusFilter)?.label}</strong>
              <button type="button" onClick={() => setStatusFilter(null)} style={{ marginLeft: 8, fontSize: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>× limpar filtro</button>
            </div>
          )}
        </div>
      )}

      {/* Agendamentos Table */}
      <div style={{ background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 8px 20px rgba(15,23,42,0.06)', border: '1px solid #e5e7eb' }}>
        <div style={{ marginBottom: 14 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>
            Agendamentos
            {statusFilter && (
              <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 8, color: '#64748b' }}>
                — {KPI_DEFS.find((d) => d.status === statusFilter)?.label}
              </span>
            )}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Nr. agendamento</label>
              <input style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }} placeholder="Protocolo..." value={tableFilter.protocolo} onChange={(e) => setTableFilter((f) => ({ ...f, protocolo: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Data</label>
              <input type="date" style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }} value={tableFilter.data} onChange={(e) => { const v = e.target.value; setTableFilter((f) => ({ ...f, data: v })); if (v) load(v); }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Fornecedor</label>
              <input style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }} placeholder="Nome do fornecedor..." value={tableFilter.fornecedor} onChange={(e) => setTableFilter((f) => ({ ...f, fornecedor: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>Transportadora</label>
              <input style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }} placeholder="Nome da transportadora..." value={tableFilter.transportadora} onChange={(e) => setTableFilter((f) => ({ ...f, transportadora: e.target.value }))} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 4 }}>NF</label>
              <input style={{ width: '100%', padding: '8px 10px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' }} placeholder="Número da NF..." value={tableFilter.nf} onChange={(e) => setTableFilter((f) => ({ ...f, nf: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" onClick={() => setTableFilter({ protocolo: '', data: '', fornecedor: '', transportadora: '', nf: '' })} style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                Limpar filtros
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ color: '#64748b' }}>Carregando agendamentos...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f8fafc' }}>
                  {['Protocolo','Status','Data','Hora','Fornecedor','Transportadora','Motorista','Doca','Volumes','Peso (kg)'].map((h) => (
                    <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agendamentos.map((item) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, whiteSpace: 'nowrap' }}>{item.protocolo || '-'}</td>
                    <td style={{ padding: '10px 12px' }}><StatusBadge status={item.status} /></td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{item.dataAgendada || '-'}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{item.horaAgendada || '-'}</td>
                    <td style={{ padding: '10px 12px', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.fornecedor}>{item.fornecedor || '-'}</td>
                    <td style={{ padding: '10px 12px', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.transportadora}>{item.transportadora || '-'}</td>
                    <td style={{ padding: '10px 12px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.motorista}>{item.motorista || '-'}</td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{item.doca?.codigo || item.docaId || '-'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{Number(item.quantidadeVolumes || 0)}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>{Number(item.pesoTotalKg || 0).toFixed(3)}</td>
                  </tr>
                ))}
                {agendamentos.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                      {statusFilter
                        ? `Nenhum agendamento com status "${KPI_DEFS.find((d) => d.status === statusFilter)?.label}".`
                        : 'Nenhum agendamento encontrado.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {agendamentos.length > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#94a3b8' }}>
            {agendamentos.length} registro{agendamentos.length !== 1 ? 's' : ''} exibido{agendamentos.length !== 1 ? 's' : ''}.
          </p>
        )}
      </div>
    </div>
  );
}