import { useEffect, useMemo, useState } from 'react';
import { api } from '../../services/api';

const initialForm = {
  transportadora: '',
  motorista: '',
  cpfMotorista: '',
  telefoneMotorista: '',
  emailMotorista: '',
  emailTransportadora: '',
  placa: '',
  dataAgendada: new Date().toISOString().slice(0, 10),
  docaId: '',
  janelaId: '',
  observacoes: '',
  motivoOcorrencia: 'Transportadora negou o agendamento.'
};

function noteKey(nota = {}) {
  return nota?.rowHash || `${nota?.numeroNf || ''}::${nota?.serie || ''}`;
}
function parseJanelaHora(codigo = '') {
  const match = String(codigo || '').match(/(\d{2}:\d{2})/);
  return match ? match[1] : '';
}
function sameDay(a, b) { return String(a || '').trim() === String(b || '').trim(); }
function formatSupplierLabel(name = '', total = 0) {
  return `${name} (${total} NF${total === 1 ? '' : 's'})`;
}
function statusColor(status = '') {
  const map = { PENDENTE_APROVACAO: '#f59e0b', APROVADO: '#10b981', CANCELADO: '#ef4444', NO_SHOW: '#8b5cf6', REAGENDADO: '#3b82f6', FINALIZADO: '#64748b', CHEGOU: '#06b6d4', EM_DESCARGA: '#f97316' };
  return map[status] || '#94a3b8';
}

// ── Supplier Dropdown ──────────────────────────────────────────────────────
function SupplierDropdown({ options, manualSuppliers, selected, onToggle, onClear, onAddManual, onRemoveManual }) {
  const [open, setOpen] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const allOptions = [
    ...options,
    ...manualSuppliers.map((s) => ({ fornecedor: s, quantidadeNotas: 0, notas: [], _manual: true }))
  ];
  const selectedLabels = allOptions.filter((item) => selected.includes(item.fornecedor)).map((item) => item.fornecedor);
  function handleAddManual() {
    const name = manualInput.trim();
    if (name) { onAddManual(name); setManualInput(''); }
  }
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={styles.inputButton}>
          {selectedLabels.length ? selectedLabels.join(', ') : 'Selecionar fornecedores'}
        </button>
        <button type="button" onClick={onClear} style={styles.clearButton}>X</button>
      </div>
      {open && (
        <div style={styles.dropdown}>
          {allOptions.map((item) => (
            <label key={item.fornecedor} style={styles.dropdownItem}>
              <input type="checkbox" checked={selected.includes(item.fornecedor)} onChange={() => onToggle(item.fornecedor)} />
              <span>
                {formatSupplierLabel(item.fornecedor, item.quantidadeNotas || item.notas?.length || 0)}
                {item._manual && <em style={{ color: '#64748b', marginLeft: 6 }}>(manual)</em>}
              </span>
              {item._manual && (
                <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveManual(item.fornecedor); }} style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>remover</button>
              )}
            </label>
          ))}
          {!allOptions.length && <div style={styles.dropdownEmpty}>Nenhum fornecedor pendente encontrado.</div>}
          <div style={{ padding: '8px 10px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 6 }}>
            <input
              style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
              placeholder="Adicionar fornecedor manual..."
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddManual())}
            />
            <button type="button" onClick={handleAddManual} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #10b981', background: '#ecfdf5', color: '#065f46', cursor: 'pointer', fontSize: 13 }}>+ Add</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Per-supplier transportadora ────────────────────────────────────────────
function TransportadoraPerSupplier({ suppliers, transportadoraMap, onChangeMap, transportadoras }) {
  if (suppliers.length < 2) return null;
  const values = suppliers.map((s) => transportadoraMap[s] || '');
  const allSame = values.every((v) => v === values[0]);
  return (
    <div style={{ marginTop: 10, border: '1px solid #fde68a', borderRadius: 12, padding: 12, background: '#fffbeb', marginBottom: 12 }}>
      <strong style={{ fontSize: 13, color: '#92400e' }}>Transportadoras por fornecedor</strong>
      <p style={{ margin: '4px 0 8px', fontSize: 12, color: '#78716c' }}>
        {allSame && values[0] ? '✓ Mesma transportadora — preenchido automaticamente.' : 'Preencha individualmente ou use o campo global.'}
      </p>
      {suppliers.map((supplier) => (
        <div key={supplier} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ minWidth: 140, fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={supplier}>{supplier}</span>
          <input
            list="transp-options-per"
            style={{ flex: 1, padding: '6px 8px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}
            placeholder="Transportadora"
            value={transportadoraMap[supplier] || ''}
            onChange={(e) => onChangeMap(supplier, e.target.value)}
          />
        </div>
      ))}
      <datalist id="transp-options-per">
        {transportadoras.map((t) => <option key={t.id || t.nome} value={t.nome || t.razaoSocial || t.name || ''} />)}
      </datalist>
    </div>
  );
}

// ── Volume edit modal ──────────────────────────────────────────────────────
function VolumeEditModal({ nota, agendamentoId, onClose, onSaved }) {
  const [volumes, setVolumes] = useState(String(nota?.volumes ?? ''));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  async function handleSave() {
    setSaving(true); setErr('');
    try {
      await api.patch(`/agendamentos/${agendamentoId}/notas/${encodeURIComponent(nota.numeroNf)}/volumes`, { volumes: Number(volumes), serie: nota.serie });
      onSaved(); onClose();
    } catch (e) { setErr(e.response?.data?.message || 'Erro ao salvar volumes.'); }
    finally { setSaving(false); }
  }
  return (
    <div style={styles.modalOverlay}>
      <div style={{ ...styles.modalBox, maxWidth: 360 }}>
        <h3 style={{ margin: '0 0 12px' }}>Editar volumes — NF {nota.numeroNf}</h3>
        <label style={styles.label}>Volumes</label>
        <input type="number" min="0" style={styles.input} value={volumes} onChange={(e) => setVolumes(e.target.value)} autoFocus />
        {err && <p style={{ color: '#ef4444', fontSize: 13 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" style={styles.primaryButton} onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ── Edit agendamento modal ─────────────────────────────────────────────────
function EditAgendamentoModal({ agendamento, docas, janelas, onClose, onSaved }) {
  const isAprovado = ['APROVADO', 'CHEGOU', 'EM_DESCARGA'].includes(agendamento?.status);
  const [form, setFormState] = useState({
    transportadora: agendamento?.transportadora || '',
    motorista: agendamento?.motorista || '',
    placa: agendamento?.placa || '',
    telefoneMotorista: agendamento?.telefoneMotorista || '',
    emailMotorista: agendamento?.emailMotorista || '',
    emailTransportadora: agendamento?.emailTransportadora || '',
    dataAgendada: agendamento?.dataAgendada || '',
    janelaId: String(agendamento?.janelaId || ''),
    docaId: String(agendamento?.docaId || ''),
    observacoes: agendamento?.observacoes || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  function setField(k, v) { setFormState((f) => ({ ...f, [k]: v })); }
  async function handleSave() {
    setSaving(true); setErr('');
    try {
      if (isAprovado) {
        if (!window.confirm('Agendamento já aprovado. Para editar, ele será cancelado e você deverá criar um novo. Continuar?')) { setSaving(false); return; }
        await api.post(`/agendamentos/${agendamento.id}/cancelar`, { motivo: 'Cancelado para edição pelo operador.' });
      } else {
        await api.patch(`/agendamentos/${agendamento.id}`, { ...form, janelaId: Number(form.janelaId), docaId: Number(form.docaId) });
      }
      onSaved(); onClose();
    } catch (e) { setErr(e.response?.data?.message || 'Erro ao salvar.'); }
    finally { setSaving(false); }
  }
  const fields = [['Transportadora', 'transportadora'], ['Motorista', 'motorista'], ['Placa', 'placa'], ['Tel. motorista', 'telefoneMotorista'], ['E-mail motorista', 'emailMotorista'], ['E-mail transportadora', 'emailTransportadora']];
  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modalBox}>
        <h3 style={{ margin: '0 0 16px' }}>Editar agendamento — {agendamento.protocolo}</h3>
        {isAprovado && (
          <div style={{ padding: '8px 12px', borderRadius: 8, background: '#fef3c7', border: '1px solid #fde68a', marginBottom: 12, fontSize: 13, color: '#92400e' }}>
            ⚠️ Agendamento aprovado. Salvar cancelará o atual.
          </div>
        )}
        <div style={styles.grid2}>
          {fields.map(([label, key]) => (
            <div key={key}>
              <label style={styles.label}>{label}</label>
              <input style={styles.input} value={form[key]} onChange={(e) => setField(key, e.target.value)} />
            </div>
          ))}
          <div>
            <label style={styles.label}>Data agendada</label>
            <input type="date" style={styles.input} value={form.dataAgendada} onChange={(e) => setField('dataAgendada', e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>Doca</label>
            <select style={styles.input} value={form.docaId} onChange={(e) => setField('docaId', e.target.value)}>
              {docas.map((d) => <option key={d.id} value={d.id}>{d.codigo}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={styles.label}>Janela</label>
            <select style={styles.input} value={form.janelaId} onChange={(e) => setField('janelaId', e.target.value)}>
              {janelas.map((j) => <option key={j.id} value={j.id}>{j.codigo}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={styles.label}>Observações</label>
            <textarea style={styles.textarea} value={form.observacoes} onChange={(e) => setField('observacoes', e.target.value)} />
          </div>
        </div>
        {err && <p style={{ color: '#ef4444', fontSize: 13 }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" style={styles.primaryButton} onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : isAprovado ? 'Cancelar e reabrir' : 'Salvar'}</button>
          <button type="button" style={styles.secondaryButton} onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

// ── KPI card ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, color, active, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{ display: 'grid', gap: 4, textAlign: 'left', padding: '14px 18px', borderRadius: 14, border: `2px solid ${active ? color : color + '30'}`, background: active ? color + '20' : color + '10', cursor: 'pointer', transition: 'all .15s' }}>
      <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 700, color }}>{value}</span>
    </button>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function AgendamentosPage() {
  const [form, setForm] = useState(initialForm);
  const [pendingGroups, setPendingGroups] = useState([]);
  const [manualSuppliers, setManualSuppliers] = useState([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState({});
  const [transportadoraMap, setTransportadoraMap] = useState({});
  const [janelas, setJanelas] = useState([]);
  const [docas, setDocas] = useState([]);
  const [transportadoras, setTransportadoras] = useState([]);
  const [painelDocas, setPainelDocas] = useState([]);
  const [agendamentos, setAgendamentos] = useState([]);
  const [selectedPainelDoca, setSelectedPainelDoca] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [kpiFilter, setKpiFilter] = useState(null);
  const [editingAgendamento, setEditingAgendamento] = useState(null);
  const [editingVolumaNota, setEditingVolumaNota] = useState(null);
  const [editingVolumaAgId, setEditingVolumaAgId] = useState(null);

  const selectedGroups = useMemo(() => pendingGroups.filter((g) => selectedSuppliers.includes(g.fornecedor)), [pendingGroups, selectedSuppliers]);
  const availableNotes = useMemo(() => selectedGroups.flatMap((g) => Array.isArray(g.notas) ? g.notas : Array.isArray(g.notasFiscais) ? g.notasFiscais : []), [selectedGroups]);
  const selectedNotesList = useMemo(() => availableNotes.filter((nota) => selectedNotes[noteKey(nota)]), [availableNotes, selectedNotes]);

  const blockedHoras = useMemo(() => {
    const doca = painelDocas.find((item) => String(item.docaId) === String(form.docaId));
    return new Set((doca?.fila || []).map((item) => String(item.horaAgendada || '').slice(0, 5)).filter(Boolean));
  }, [painelDocas, form.docaId]);

  const availableJanelas = useMemo(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    return janelas.filter((janela) => {
      const hora = parseJanelaHora(janela.codigo || janela.descricao || '');
      if (!hora) return false;
      if (form.docaId && blockedHoras.has(hora)) return false;
      if (sameDay(form.dataAgendada, today) && hora <= currentTime) return false;
      return true;
    });
  }, [janelas, blockedHoras, form.dataAgendada, form.docaId]);

  const resolvedTransportadora = useMemo(() => {
    if (selectedSuppliers.length <= 1) return form.transportadora;
    const vals = [...new Set(selectedSuppliers.map((s) => (transportadoraMap[s] || '').trim()).filter(Boolean))];
    return vals.length === 1 ? vals[0] : vals.join(' | ');
  }, [selectedSuppliers, transportadoraMap, form.transportadora]);

  const kpiDefs = [
    { key: 'PENDENTE_APROVACAO', label: 'Pendentes', color: '#f59e0b' },
    { key: 'APROVADO', label: 'Aprovados', color: '#10b981' },
    { key: 'CANCELADO', label: 'Cancelados', color: '#ef4444' },
    { key: 'NO_SHOW', label: 'No-show', color: '#8b5cf6' },
    { key: 'REAGENDADO', label: 'Reagendados', color: '#3b82f6' },
    { key: 'FINALIZADO', label: 'Finalizados', color: '#64748b' },
  ];

  const kpis = useMemo(() => {
    const counts = Object.fromEntries(kpiDefs.map((d) => [d.key, 0]));
    for (const ag of agendamentos) if (counts[ag.status] !== undefined) counts[ag.status]++;
    return counts;
  }, [agendamentos]);

  const filteredAgendamentos = useMemo(() => kpiFilter ? agendamentos.filter((ag) => ag.status === kpiFilter) : agendamentos, [agendamentos, kpiFilter]);

  async function loadAgendamentos() {
    const { data } = await api.get('/agendamentos');
    setAgendamentos(Array.isArray(data) ? data : []);
  }
  async function loadPainel(date = form.dataAgendada) {
    try {
      const { data } = await api.get('/dashboard/docas', { params: { dataAgendada: date } });
      const items = Array.isArray(data) ? data : [];
      setPainelDocas(items);
      setSelectedPainelDoca((current) => current || items[0]?.docaId || null);
    } catch { setPainelDocas([]); }
  }
  async function loadBase() {
    setLoading(true); setError('');
    try {
      const [pendentesRes, janelasRes, docasRes, transpRes] = await Promise.all([
        api.get('/public/fornecedores-pendentes'),
        api.get('/cadastros/janelas'),
        api.get('/cadastros/docas'),
        api.get('/cadastros/transportadoras').catch(() => ({ data: [] }))
      ]);
      setPendingGroups(Array.isArray(pendentesRes.data) ? pendentesRes.data : []);
      setJanelas(Array.isArray(janelasRes.data) ? janelasRes.data : []);
      setDocas(Array.isArray(docasRes.data) ? docasRes.data : []);
      setTransportadoras(Array.isArray(transpRes.data) ? transpRes.data : []);
      const docasData = Array.isArray(docasRes.data) ? docasRes.data : [];
      const janelasData = Array.isArray(janelasRes.data) ? janelasRes.data : [];
      setForm((old) => ({ ...old, docaId: old.docaId || String(docasData[0]?.id || ''), janelaId: old.janelaId || String(janelasData[0]?.id || '') }));
      await Promise.all([loadAgendamentos(), loadPainel(form.dataAgendada)]);
    } catch (err) {
      setError(err.response?.data?.message || 'Falha ao carregar dados.');
    } finally { setLoading(false); }
  }

  useEffect(() => { loadBase(); }, []);
  useEffect(() => { loadPainel(form.dataAgendada); }, [form.dataAgendada]);
  useEffect(() => {
    const next = {};
    for (const nota of availableNotes) next[noteKey(nota)] = true;
    setSelectedNotes(next);
  }, [selectedSuppliers.join('|'), availableNotes.length]);

  useEffect(() => {
    if (selectedSuppliers.length > 1) {
      const vals = [...new Set(selectedSuppliers.map((s) => (transportadoraMap[s] || '').trim()).filter(Boolean))];
      if (vals.length === 1) setForm((f) => ({ ...f, transportadora: vals[0] }));
    }
  }, [transportadoraMap, selectedSuppliers.join('|')]);

  useEffect(() => {
    if (selectedSuppliers.length === 1) {
      const supplier = selectedSuppliers[0];
      const group = pendingGroups.find((g) => g.fornecedor === supplier);
      if (group?.transportadora) {
        setForm((f) => ({ ...f, transportadora: group.transportadora }));
        autoFillTransportadora(group.transportadora);
        return;
      }
      // Try linked transportadora from cadastro
      api.get(`/cadastros/transportadoras/por-fornecedor?nome=${encodeURIComponent(supplier)}`)
        .then(({ data }) => {
          if (data?.nome) {
            setForm((f) => ({
              ...f,
              transportadora: data.nome,
              emailTransportadora: f.emailTransportadora || data.email || data.emailTransportadora || '',
              telefoneMotorista: f.telefoneMotorista || data.telefoneMotorista || data.telefone || '',
            }));
          }
        })
        .catch(() => {});
    }
  }, [selectedSuppliers.join('|')]);

  useEffect(() => {
    if (!availableJanelas.some((j) => String(j.id) === String(form.janelaId))) {
      setForm((old) => ({ ...old, janelaId: String(availableJanelas[0]?.id || '') }));
    }
  }, [availableJanelas, form.janelaId]);

  // Passo 4: quando transportadora muda manualmente, tentar auto-preencher email/telefone
  useEffect(() => {
    if (form.transportadora) autoFillTransportadora(form.transportadora);
  }, [form.transportadora]);

  function toggleSupplier(name) { setSelectedSuppliers((c) => c.includes(name) ? c.filter((x) => x !== name) : [...c, name]); }
  function clearSuppliers() { setSelectedSuppliers([]); setSelectedNotes({}); setTransportadoraMap({}); }
  function addManualSupplier(name) {
    if (!manualSuppliers.includes(name)) setManualSuppliers((s) => [...s, name]);
    setSelectedSuppliers((s) => s.includes(name) ? s : [...s, name]);
  }
  function removeManualSupplier(name) { setManualSuppliers((s) => s.filter((x) => x !== name)); setSelectedSuppliers((s) => s.filter((x) => x !== name)); }
  function toggleNote(nota) { const key = noteKey(nota); setSelectedNotes((c) => ({ ...c, [key]: !c[key] })); }
  function setField(field, value) { setForm((old) => ({ ...old, [field]: value })); }
  function setTranspForSupplier(supplier, value) { setTransportadoraMap((m) => ({ ...m, [supplier]: value })); }

  // Passo 4: auto-fill email da transportadora e telefone do motorista a partir do cadastro
  function autoFillTransportadora(nomeTransp) {
    if (!nomeTransp) return;
    const norm = (s) => String(s || '').trim().toLowerCase();
    const found = transportadoras.find(
      (t) => norm(t.nome) === norm(nomeTransp) || norm(t.razaoSocial) === norm(nomeTransp) || norm(t.name) === norm(nomeTransp)
    );
    if (!found) return;
    setForm((f) => ({
      ...f,
      emailTransportadora: f.emailTransportadora || found.email || found.emailTransportadora || '',
      telefoneMotorista: f.telefoneMotorista || found.telefoneMotorista || found.telefone || '',
    }));
  }

  function buildPayload() {
    const janela = janelas.find((item) => String(item.id) === String(form.janelaId));
    const horaAgendada = parseJanelaHora(janela?.codigo || janela?.descricao || '');
    const transportadora = selectedSuppliers.length > 1 ? resolvedTransportadora : form.transportadora;
    return { fornecedor: selectedSuppliers.join(' | '), transportadora, motorista: form.motorista, cpfMotorista: form.cpfMotorista, telefoneMotorista: form.telefoneMotorista, emailMotorista: form.emailMotorista, emailTransportadora: form.emailTransportadora, placa: form.placa, dataAgendada: form.dataAgendada, horaAgendada, janelaId: Number(form.janelaId), docaId: Number(form.docaId), observacoes: form.observacoes, notasFiscais: selectedNotesList };
  }

  async function handleSave(e) {
    e.preventDefault(); setMessage(''); setError('');
    try {
      if (!selectedSuppliers.length) throw new Error('Selecione ao menos um fornecedor.');
      await api.post('/agendamentos', buildPayload());
      setMessage('Agendamento salvo com sucesso.');
      await loadBase(); clearSuppliers();
    } catch (err) { setError(err.response?.data?.message || err.message || 'Falha ao salvar.'); }
  }

  async function handleOccurrence() {
    setMessage(''); setError('');
    try {
      if (!selectedSuppliers.length) throw new Error('Selecione ao menos um fornecedor.');
      if (!selectedNotesList.length) throw new Error('Selecione ao menos uma NF para a ocorrência.');
      const { data } = await api.post('/agendamentos/ocorrencia', { fornecedor: selectedSuppliers.join(' | '), transportadora: resolvedTransportadora || form.transportadora, motivo: form.motivoOcorrencia, notasFiscais: selectedNotesList });
      setMessage(`Ocorrência registrada. Notas removidas: ${data?.removed?.removed ?? data?.removed ?? 0}.`);
      await loadBase(); clearSuppliers();
    } catch (err) { setError(err.response?.data?.message || err.message || 'Falha ao registrar a ocorrência.'); }
  }

  const selectedPainel = painelDocas.find((item) => String(item.docaId) === String(selectedPainelDoca)) || null;
  const hasManualSelected = manualSuppliers.some((s) => selectedSuppliers.includes(s));

  return (
    <div style={styles.page}>
      {/* KPIs */}
      <div>
        <h2 style={{ margin: '0 0 10px', fontSize: 20 }}>KPIs</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
          {kpiDefs.map(({ key, label, color }) => (
            <KpiCard key={key} label={label} value={kpis[key] || 0} color={color} active={kpiFilter === key} onClick={() => setKpiFilter((f) => f === key ? null : key)} />
          ))}
        </div>
        {kpiFilter && (
          <div style={{ marginTop: 6, fontSize: 13, color: '#475569' }}>
            Filtrando: <strong>{kpiDefs.find((d) => d.key === kpiFilter)?.label}</strong>
            <button type="button" onClick={() => setKpiFilter(null)} style={{ marginLeft: 8, fontSize: 12, background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>× limpar</button>
          </div>
        )}
      </div>

      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Agendamentos internos</h1>
          <p style={styles.subtitle}>Selecione fornecedores pendentes, notas fiscais, doca e janela para montar o agendamento.</p>
        </div>
      </div>

      {(message || error) && (
        <div style={{ ...styles.feedback, ...(error ? styles.feedbackError : styles.feedbackSuccess) }}>{error || message}</div>
      )}

      <div style={styles.layout}>
        <form onSubmit={handleSave} style={styles.card}>
          <h2 style={styles.cardTitle}>Novo agendamento</h2>

          <div style={styles.fieldBlock}>
            <label style={styles.label}>Fornecedores <span style={{ fontWeight: 400, color: '#64748b', fontSize: 12 }}>(selecione do relatório ou adicione manualmente)</span></label>
            <SupplierDropdown
              options={pendingGroups}
              manualSuppliers={manualSuppliers}
              selected={selectedSuppliers}
              onToggle={toggleSupplier}
              onClear={clearSuppliers}
              onAddManual={addManualSupplier}
              onRemoveManual={removeManualSupplier}
            />
          </div>

          <TransportadoraPerSupplier
            suppliers={selectedSuppliers}
            transportadoraMap={transportadoraMap}
            onChangeMap={setTranspForSupplier}
            transportadoras={transportadoras}
          />

          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>
                Transportadora
                {selectedSuppliers.length > 1 && <em style={{ fontWeight: 400, color: '#64748b', fontSize: 11, marginLeft: 4 }}>(preenche todos)</em>}
              </label>
              <input
                list="transp-global-list"
                style={styles.input}
                value={selectedSuppliers.length > 1 ? resolvedTransportadora : form.transportadora}
                onChange={(e) => {
                  setField('transportadora', e.target.value);
                  if (selectedSuppliers.length > 1) {
                    const val = e.target.value;
                    setTransportadoraMap((m) => { const next = { ...m }; selectedSuppliers.forEach((s) => { next[s] = val; }); return next; });
                  }
                }}
              />
              <datalist id="transp-global-list">
                {transportadoras.map((t) => <option key={t.id || t.nome} value={t.nome || t.razaoSocial || t.name || ''} />)}
              </datalist>
            </div>
            <div>
              <label style={styles.label}>
                E-mail transportadora
                {form.emailTransportadora && (() => {
                  const norm = (s) => String(s || '').trim().toLowerCase();
                  const found = transportadoras.find((t) => norm(t.nome) === norm(form.transportadora) || norm(t.razaoSocial) === norm(form.transportadora));
                  const isAuto = found && (found.email === form.emailTransportadora || found.emailTransportadora === form.emailTransportadora);
                  return isAuto ? (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#3b82f6', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 99, padding: '2px 8px' }}>✓ preenchido do cadastro</span>
                  ) : null;
                })()}
              </label>
              <input style={styles.input} value={form.emailTransportadora} onChange={(e) => setField('emailTransportadora', e.target.value)} placeholder="Preenchido automaticamente se cadastrado" />
            </div>
            <div>
              <label style={styles.label}>Motorista</label>
              <input style={styles.input} value={form.motorista} onChange={(e) => setField('motorista', e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label style={styles.label}>Placa</label>
              <input style={styles.input} value={form.placa} onChange={(e) => setField('placa', e.target.value.toUpperCase())} placeholder="Opcional" />
            </div>
            <div>
              <label style={styles.label}>CPF motorista</label>
              <input style={styles.input} value={form.cpfMotorista} onChange={(e) => setField('cpfMotorista', e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label style={styles.label}>
                Telefone motorista
                {form.telefoneMotorista && (() => {
                  const norm = (s) => String(s || '').trim().toLowerCase();
                  const found = transportadoras.find((t) => norm(t.nome) === norm(form.transportadora) || norm(t.razaoSocial) === norm(form.transportadora));
                  const isAuto = found && (found.telefoneMotorista === form.telefoneMotorista || found.telefone === form.telefoneMotorista);
                  return isAuto ? (
                    <span style={{ marginLeft: 8, fontSize: 11, color: '#3b82f6', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 99, padding: '2px 8px' }}>✓ preenchido do cadastro</span>
                  ) : null;
                })()}
              </label>
              <input style={styles.input} value={form.telefoneMotorista} onChange={(e) => setField('telefoneMotorista', e.target.value)} placeholder="Preenchido automaticamente se cadastrado" />
            </div>
            <div>
              <label style={styles.label}>E-mail motorista</label>
              <input style={styles.input} value={form.emailMotorista} onChange={(e) => setField('emailMotorista', e.target.value)} placeholder="Opcional" />
            </div>
            <div>
              <label style={styles.label}>Data</label>
              <input type="date" style={styles.input} value={form.dataAgendada} onChange={(e) => setField('dataAgendada', e.target.value)} />
            </div>
            <div>
              <label style={styles.label}>Doca</label>
              <select style={styles.input} value={form.docaId} onChange={(e) => setField('docaId', e.target.value)}>
                {docas.map((doca) => <option key={doca.id} value={doca.id}>{doca.codigo}</option>)}
              </select>
            </div>
            <div>
              <label style={styles.label}>
                Janela disponível
                {(() => {
                  const janela = availableJanelas.find((j) => String(j.id) === String(form.janelaId));
                  const hora = parseJanelaHora(janela?.codigo || janela?.descricao || '');
                  return hora ? (
                    <span style={{ marginLeft: 8, fontWeight: 700, color: '#10b981', fontSize: 13, background: '#ecfdf5', border: '1px solid #10b981', borderRadius: 99, padding: '2px 10px' }}>
                      ⏰ {hora}
                    </span>
                  ) : null;
                })()}
              </label>
              {availableJanelas.length === 0 ? (
                <div style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', fontSize: 13 }}>
                  ⚠️ Nenhuma janela disponível para esta doca e data. Todas as janelas estão ocupadas ou já passaram.
                </div>
              ) : (
                <select style={styles.input} value={form.janelaId} onChange={(e) => setField('janelaId', e.target.value)}>
                  {availableJanelas.map((janela) => {
                    const hora = parseJanelaHora(janela.codigo || janela.descricao || '');
                    return <option key={janela.id} value={janela.id}>{janela.codigo}{hora ? ` — ${hora}` : ''}</option>;
                  })}
                </select>
              )}
            </div>
          </div>

          <div style={styles.fieldBlock}>
            <label style={styles.label}>Observações</label>
            <textarea style={styles.textarea} value={form.observacoes} onChange={(e) => setField('observacoes', e.target.value)} />
          </div>

          <div style={styles.fieldBlock}>
            <label style={styles.label}>Motivo da ocorrência</label>
            <textarea style={styles.textarea} value={form.motivoOcorrencia} onChange={(e) => setField('motivoOcorrencia', e.target.value)} />
          </div>

          {/* Notes */}
          <div style={styles.notesBox}>
            <div style={styles.notesHeader}>
              <strong>Notas selecionáveis</strong>
              <span>{selectedNotesList.length} selecionada(s)</span>
            </div>
            <div style={styles.notesList}>
              {hasManualSelected && !availableNotes.length && (
                <div style={{ padding: '10px 14px', color: '#64748b', fontSize: 13 }}>Fornecedor manual — sem NFs no relatório. O agendamento será criado sem notas vinculadas.</div>
              )}
              {availableNotes.map((nota) => {
                const key = noteKey(nota);
                return (
                  <label key={key} style={styles.noteItem}>
                    <input type="checkbox" checked={!!selectedNotes[key]} onChange={() => toggleNote(nota)} />
                    <span>
                      NF {nota.numeroNf || '-'} | Série {nota.serie || '-'} |
                      Destino {nota.destino || '-'} |
                      Vol <strong>{Number(nota.volumes ?? 0)}</strong> |
                      Peso {Number(nota.peso || 0).toFixed(3)}
                    </span>
                  </label>
                );
              })}
              {!availableNotes.length && !hasManualSelected && (
                <div style={styles.dropdownEmpty}>Selecione um ou mais fornecedores para listar as notas.</div>
              )}
            </div>
          </div>

          <div style={styles.actionsColumn}>
            <button type="submit" style={styles.primaryButton} disabled={loading}>Salvar agendamento</button>
            <button type="button" style={styles.secondaryButton} onClick={handleOccurrence} disabled={loading}>Ocorrência</button>
          </div>
        </form>

        {/* Doca panel */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Painel de docas</h2>
          <div style={styles.docaGrid}>
            {painelDocas.map((doca) => (
              <button type="button" key={doca.docaId} onClick={() => setSelectedPainelDoca(doca.docaId)}
                style={{ ...styles.docaCard, borderColor: String(selectedPainelDoca) === String(doca.docaId) ? '#111827' : '#d1d5db' }}>
                <strong>{doca.codigo}</strong>
                <span>Status: {doca.ocupacaoAtual}</span>
                <span>Notas: {doca.totalNotas || 0}</span>
                <span>Volumes: {Number(doca.totalVolumes || 0)}</span>
                <span>Peso: {Number(doca.totalPesoKg || 0).toFixed(3)}</span>
              </button>
            ))}
          </div>
          <div style={styles.docaDetail}>
            <h3 style={{ marginTop: 0 }}>{selectedPainel?.codigo || '-'}</h3>
            {selectedPainel?.fila?.length ? selectedPainel.fila.map((item) => (
              <div key={item.id || `${item.protocolo}-${item.horaAgendada}`} style={styles.queueCard}>
                <div style={styles.queueHeader}>
                  <strong>{item.protocolo || 'Sem protocolo'}</strong>
                  <span>{item.horaAgendada || '-'}</span>
                </div>
                <div style={styles.queueMeta}>
                  <span>Fornecedor: {item.fornecedor || '-'}</span>
                  <span>Transportadora: {item.transportadora || '-'}</span>
                  <span>Notas: {item.quantidadeNotas || 0}</span>
                  <span>Volumes: {Number(item.quantidadeVolumes || 0)}</span>
                  <span>Peso: {Number(item.pesoTotalKg || 0).toFixed(3)}</span>
                </div>
                <div style={styles.noteTableWrap}>
                  <table style={styles.table}>
                    <thead><tr><th>NF</th><th>Destino</th><th>Itens</th><th>Volumes</th><th>Peso</th></tr></thead>
                    <tbody>
                      {(item.detalhesNotas || []).map((nota, index) => (
                        <tr key={`${item.id}-${nota.numeroNf}-${index}`}>
                          <td>{nota.numeroNf || '-'}</td>
                          <td>{nota.destino || '-'}</td>
                          <td>{nota.quantidadeItens || 0}</td>
                          <td>
                            {Number(nota.volumes ?? 0)}
                            <button type="button" title="Editar volumes" onClick={() => { setEditingVolumaNota(nota); setEditingVolumaAgId(item.id); }}
                              style={{ marginLeft: 6, fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#3b82f6' }}>✏️</button>
                          </td>
                          <td>{Number(nota.peso || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )) : <div style={styles.dropdownEmpty}>Nenhum agendamento para a data filtrada.</div>}
          </div>
        </div>
      </div>

      {/* Agendamentos table */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>
          Agendamentos existentes
          {kpiFilter && <span style={{ fontSize: 14, fontWeight: 400, marginLeft: 8, color: '#64748b' }}>— {kpiDefs.find((d) => d.key === kpiFilter)?.label}</span>}
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr><th>Protocolo</th><th>Status</th><th>Data</th><th>Hora</th><th>Fornecedor</th><th>Transportadora</th><th>Doca</th><th>Volumes</th><th>Ações</th></tr>
            </thead>
            <tbody>
              {filteredAgendamentos.map((item) => (
                <tr key={item.id}>
                  <td>{item.protocolo}</td>
                  <td>
                    <span style={{ padding: '3px 8px', borderRadius: 99, fontSize: 12, fontWeight: 600, background: statusColor(item.status) + '20', color: statusColor(item.status) }}>
                      {item.status}
                    </span>
                  </td>
                  <td>{item.dataAgendada}</td>
                  <td>{item.horaAgendada}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.fornecedor}>{item.fornecedor || '-'}</td>
                  <td>{item.transportadora || '-'}</td>
                  <td>{item.doca?.codigo || item.docaId || '-'}</td>
                  <td>{Number(item.quantidadeVolumes || 0)}</td>
                  <td>
                    <button type="button" onClick={() => setEditingAgendamento(item)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#f8fafc', cursor: 'pointer' }}>
                      ✏️ Editar
                    </button>
                  </td>
                </tr>
              ))}
              {filteredAgendamentos.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', color: '#64748b', padding: 16 }}>Nenhum agendamento{kpiFilter ? ' com este status' : ''}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modals */}
      {editingAgendamento && (
        <EditAgendamentoModal agendamento={editingAgendamento} docas={docas} janelas={janelas}
          onClose={() => setEditingAgendamento(null)} onSaved={() => { loadBase(); setEditingAgendamento(null); }} />
      )}
      {editingVolumaNota && editingVolumaAgId && (
        <VolumeEditModal nota={editingVolumaNota} agendamentoId={editingVolumaAgId}
          onClose={() => { setEditingVolumaNota(null); setEditingVolumaAgId(null); }}
          onSaved={() => { loadBase(); setEditingVolumaNota(null); setEditingVolumaAgId(null); }} />
      )}
    </div>
  );
}

const styles = {
  page: { padding: 24, display: 'grid', gap: 16, background: '#f8fafc', minHeight: '100vh' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: 28 },
  subtitle: { margin: '6px 0 0', color: '#475569' },
  feedback: { padding: 12, borderRadius: 10, border: '1px solid transparent' },
  feedbackSuccess: { background: '#ecfdf5', borderColor: '#10b981', color: '#065f46' },
  feedbackError: { background: '#fef2f2', borderColor: '#ef4444', color: '#991b1b' },
  layout: { display: 'grid', gridTemplateColumns: '1.25fr 1fr', gap: 16 },
  card: { background: '#fff', borderRadius: 16, padding: 20, boxShadow: '0 8px 20px rgba(15,23,42,0.06)', border: '1px solid #e5e7eb' },
  cardTitle: { marginTop: 0, marginBottom: 16, fontSize: 20 },
  label: { display: 'block', marginBottom: 6, fontWeight: 600, color: '#0f172a' },
  input: { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  inputButton: { flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' },
  clearButton: { minWidth: 42, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' },
  textarea: { width: '100%', minHeight: 74, padding: 12, borderRadius: 10, border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, marginBottom: 12 },
  fieldBlock: { marginBottom: 16 },
  dropdown: { position: 'absolute', left: 0, right: 0, top: 'calc(100% + 8px)', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 12, padding: 8, maxHeight: 280, overflowY: 'auto', zIndex: 30, boxShadow: '0 12px 28px rgba(15,23,42,0.12)' },
  dropdownItem: { display: 'flex', gap: 8, padding: '8px 10px', alignItems: 'center', cursor: 'pointer' },
  dropdownEmpty: { padding: 12, color: '#64748b' },
  notesBox: { border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  notesHeader: { display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc' },
  notesList: { maxHeight: 220, overflowY: 'auto' },
  noteItem: { display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid #f1f5f9', alignItems: 'center' },
  actionsColumn: { display: 'grid', gap: 10 },
  primaryButton: { padding: '12px 14px', borderRadius: 12, border: 'none', background: '#111827', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  secondaryButton: { padding: '12px 14px', borderRadius: 12, border: '1px solid #111827', background: '#fff', color: '#111827', fontWeight: 700, cursor: 'pointer' },
  docaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 },
  docaCard: { display: 'grid', gap: 4, textAlign: 'left', borderRadius: 14, border: '2px solid #d1d5db', background: '#fff', padding: 14, cursor: 'pointer' },
  docaDetail: { border: '1px solid #e5e7eb', borderRadius: 14, padding: 14 },
  queueCard: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12, background: '#fafafa' },
  queueHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 },
  queueMeta: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 12, fontSize: 13 },
  noteTableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' },
  modalOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modalBox: { background: '#fff', borderRadius: 18, padding: 24, maxWidth: 640, width: '90%', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' },
};
