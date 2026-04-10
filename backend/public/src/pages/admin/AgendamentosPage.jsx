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

function sameDay(a, b) {
  return String(a || '').trim() === String(b || '').trim();
}

function formatSupplierLabel(name = '', total = 0) {
  return `${name} (${total} NF${total === 1 ? '' : 's'})`;
}

function SupplierDropdown({ options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter((item) => selected.includes(item.fornecedor)).map((item) => item.fornecedor);

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
          {options.map((item) => (
            <label key={item.fornecedor} style={styles.dropdownItem}>
              <input
                type="checkbox"
                checked={selected.includes(item.fornecedor)}
                onChange={() => onToggle(item.fornecedor)}
              />
              <span>{formatSupplierLabel(item.fornecedor, item.quantidadeNotas || item.notas?.length || 0)}</span>
            </label>
          ))}
          {!options.length && <div style={styles.dropdownEmpty}>Nenhum fornecedor pendente encontrado.</div>}
        </div>
      )}
    </div>
  );
}

export default function AgendamentosPage() {
  const [form, setForm] = useState(initialForm);
  const [pendingGroups, setPendingGroups] = useState([]);
  const [selectedSuppliers, setSelectedSuppliers] = useState([]);
  const [selectedNotes, setSelectedNotes] = useState({});
  const [janelas, setJanelas] = useState([]);
  const [docas, setDocas] = useState([]);
  const [painelDocas, setPainelDocas] = useState([]);
  const [agendamentos, setAgendamentos] = useState([]);
  const [selectedPainelDoca, setSelectedPainelDoca] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedGroups = useMemo(
    () => pendingGroups.filter((group) => selectedSuppliers.includes(group.fornecedor)),
    [pendingGroups, selectedSuppliers]
  );

  const availableNotes = useMemo(
    () => selectedGroups.flatMap((group) => Array.isArray(group.notas) ? group.notas : Array.isArray(group.notasFiscais) ? group.notasFiscais : []),
    [selectedGroups]
  );

  const selectedNotesList = useMemo(
    () => availableNotes.filter((nota) => selectedNotes[noteKey(nota)]),
    [availableNotes, selectedNotes]
  );

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
    } catch {
      setPainelDocas([]);
    }
  }

  async function loadBase() {
    setLoading(true);
    setError('');
    try {
      const [pendentesRes, janelasRes, docasRes] = await Promise.all([
        api.get('/public/fornecedores-pendentes'),
        api.get('/cadastros/janelas'),
        api.get('/cadastros/docas')
      ]);
      const pendentes = Array.isArray(pendentesRes.data) ? pendentesRes.data : [];
      const janelasData = Array.isArray(janelasRes.data) ? janelasRes.data : [];
      const docasData = Array.isArray(docasRes.data) ? docasRes.data : [];
      setPendingGroups(pendentes);
      setJanelas(janelasData);
      setDocas(docasData);
      setForm((old) => ({
        ...old,
        docaId: old.docaId || String(docasData[0]?.id || ''),
        janelaId: old.janelaId || String(janelasData[0]?.id || '')
      }));
      await Promise.all([loadAgendamentos(), loadPainel(form.dataAgendada)]);
    } catch (err) {
      setError(err.response?.data?.message || 'Falha ao carregar dados da tela de agendamentos.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBase();
  }, []);

  useEffect(() => {
    loadPainel(form.dataAgendada);
  }, [form.dataAgendada]);

  useEffect(() => {
    const next = {};
    for (const nota of availableNotes) {
      next[noteKey(nota)] = true;
    }
    setSelectedNotes(next);
  }, [selectedSuppliers.join('|'), availableNotes.length]);

  useEffect(() => {
    if (!availableJanelas.some((janela) => String(janela.id) === String(form.janelaId))) {
      setForm((old) => ({ ...old, janelaId: String(availableJanelas[0]?.id || '') }));
    }
  }, [availableJanelas, form.janelaId]);

  function toggleSupplier(name) {
    setSelectedSuppliers((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : [...current, name]);
  }

  function clearSuppliers() {
    setSelectedSuppliers([]);
    setSelectedNotes({});
  }

  function toggleNote(nota) {
    const key = noteKey(nota);
    setSelectedNotes((current) => ({ ...current, [key]: !current[key] }));
  }

  function setField(field, value) {
    setForm((old) => ({ ...old, [field]: value }));
  }

  function buildPayload() {
    const janela = janelas.find((item) => String(item.id) === String(form.janelaId));
    const horaAgendada = parseJanelaHora(janela?.codigo || janela?.descricao || '');
    return {
      fornecedor: selectedSuppliers.join(' | '),
      transportadora: form.transportadora,
      motorista: form.motorista,
      cpfMotorista: form.cpfMotorista,
      telefoneMotorista: form.telefoneMotorista,
      emailMotorista: form.emailMotorista,
      emailTransportadora: form.emailTransportadora,
      placa: form.placa,
      dataAgendada: form.dataAgendada,
      horaAgendada,
      janelaId: Number(form.janelaId),
      docaId: Number(form.docaId),
      observacoes: form.observacoes,
      notasFiscais: selectedNotesList
    };
  }

  async function handleSave(e) {
    e.preventDefault();
    setMessage('');
    setError('');
    try {
      if (!selectedSuppliers.length) throw new Error('Selecione ao menos um fornecedor.');
      if (!selectedNotesList.length) throw new Error('Selecione ao menos uma NF.');
      const payload = buildPayload();
      await api.post('/agendamentos', payload);
      setMessage('Agendamento salvo com sucesso.');
      await loadBase();
      clearSuppliers();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Falha ao salvar o agendamento.');
    }
  }

  async function handleOccurrence() {
    setMessage('');
    setError('');
    try {
      if (!selectedSuppliers.length) throw new Error('Selecione ao menos um fornecedor.');
      if (!selectedNotesList.length) throw new Error('Selecione ao menos uma NF para a ocorrência.');
      const payload = {
        fornecedor: selectedSuppliers.join(' | '),
        transportadora: form.transportadora,
        motivo: form.motivoOcorrencia,
        notasFiscais: selectedNotesList
      };
      const { data } = await api.post('/agendamentos/ocorrencia', payload);
      setMessage(`Ocorrência registrada. Notas removidas: ${data?.removed?.removed ?? data?.removed ?? 0}.`);
      await loadBase();
      clearSuppliers();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Falha ao registrar a ocorrência.');
    }
  }

  const selectedPainel = painelDocas.find((item) => String(item.docaId) === String(selectedPainelDoca)) || null;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Agendamentos internos</h1>
          <p style={styles.subtitle}>Selecione fornecedores pendentes, notas fiscais, doca e janela para montar o agendamento.</p>
        </div>
      </div>

      {(message || error) && (
        <div style={{ ...styles.feedback, ...(error ? styles.feedbackError : styles.feedbackSuccess) }}>
          {error || message}
        </div>
      )}

      <div style={styles.layout}>
        <form onSubmit={handleSave} style={styles.card}>
          <h2 style={styles.cardTitle}>Novo agendamento</h2>

          <div style={styles.fieldBlock}>
            <label style={styles.label}>Fornecedores pendentes</label>
            <SupplierDropdown
              options={pendingGroups}
              selected={selectedSuppliers}
              onToggle={toggleSupplier}
              onClear={clearSuppliers}
            />
          </div>

          <div style={styles.grid2}>
            <div>
              <label style={styles.label}>Transportadora</label>
              <input style={styles.input} value={form.transportadora} onChange={(e) => setField('transportadora', e.target.value)} />
            </div>
            <div>
              <label style={styles.label}>E-mail transportadora</label>
              <input style={styles.input} value={form.emailTransportadora} onChange={(e) => setField('emailTransportadora', e.target.value)} />
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
              <label style={styles.label}>Telefone motorista</label>
              <input style={styles.input} value={form.telefoneMotorista} onChange={(e) => setField('telefoneMotorista', e.target.value)} placeholder="Opcional" />
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
              <label style={styles.label}>Janela disponível</label>
              <select style={styles.input} value={form.janelaId} onChange={(e) => setField('janelaId', e.target.value)}>
                {availableJanelas.map((janela) => <option key={janela.id} value={janela.id}>{janela.codigo}</option>)}
              </select>
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

          <div style={styles.notesBox}>
            <div style={styles.notesHeader}>
              <strong>Notas selecionáveis</strong>
              <span>{selectedNotesList.length} selecionada(s)</span>
            </div>
            <div style={styles.notesList}>
              {availableNotes.map((nota) => {
                const key = noteKey(nota);
                return (
                  <label key={key} style={styles.noteItem}>
                    <input type="checkbox" checked={!!selectedNotes[key]} onChange={() => toggleNote(nota)} />
                    <span>
                      NF {nota.numeroNf || '-'} | Série {nota.serie || '-'} | Destino {nota.destino || '-'} | Itens {Number(nota.quantidadeItens || 0)} | Volumes {Number(nota.volumes || 0)} | Peso {Number(nota.peso || 0).toFixed(3)}
                    </span>
                  </label>
                );
              })}
              {!availableNotes.length && <div style={styles.dropdownEmpty}>Selecione um ou mais fornecedores para listar as notas.</div>}
            </div>
          </div>

          <div style={styles.actionsColumn}>
            <button type="submit" style={styles.primaryButton} disabled={loading}>Salvar agendamento</button>
            <button type="button" style={styles.secondaryButton} onClick={handleOccurrence} disabled={loading}>Ocorrência</button>
          </div>
        </form>

        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Painel de docas</h2>
          <div style={styles.docaGrid}>
            {painelDocas.map((doca) => (
              <button
                type="button"
                key={doca.docaId}
                onClick={() => setSelectedPainelDoca(doca.docaId)}
                style={{
                  ...styles.docaCard,
                  borderColor: String(selectedPainelDoca) === String(doca.docaId) ? '#111827' : '#d1d5db'
                }}
              >
                <strong>{doca.codigo}</strong>
                <span>Status: {doca.ocupacaoAtual}</span>
                <span>Notas: {doca.totalNotas || 0}</span>
                <span>Volumes: {doca.totalVolumes || 0}</span>
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
                  <span>Itens: {item.quantidadeItens || 0}</span>
                  <span>Volumes: {item.quantidadeVolumes || 0}</span>
                  <span>Peso: {Number(item.pesoTotalKg || 0).toFixed(3)}</span>
                  <span>Destino: {(item.destinos || []).join(', ') || '-'}</span>
                </div>
                <div style={styles.noteTableWrap}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th>NF</th>
                        <th>Destino</th>
                        <th>Itens</th>
                        <th>Volumes</th>
                        <th>Peso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(item.detalhesNotas || []).map((nota, index) => (
                        <tr key={`${item.id}-${nota.numeroNf}-${index}`}>
                          <td>{nota.numeroNf || '-'}</td>
                          <td>{nota.destino || '-'}</td>
                          <td>{nota.quantidadeItens || 0}</td>
                          <td>{nota.volumes || 0}</td>
                          <td>{Number(nota.peso || 0).toFixed(3)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )) : <div style={styles.dropdownEmpty}>Nenhum agendamento ocupando a doca para a data filtrada.</div>}
          </div>
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.cardTitle}>Agendamentos existentes</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Status</th>
                <th>Data</th>
                <th>Hora</th>
                <th>Fornecedor</th>
                <th>Transportadora</th>
                <th>Doca</th>
              </tr>
            </thead>
            <tbody>
              {agendamentos.map((item) => (
                <tr key={item.id}>
                  <td>{item.protocolo}</td>
                  <td>{item.status}</td>
                  <td>{item.dataAgendada}</td>
                  <td>{item.horaAgendada}</td>
                  <td>{item.fornecedor || '-'}</td>
                  <td>{item.transportadora || '-'}</td>
                  <td>{item.doca?.codigo || item.docaId || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
  inputButton: { flex: 1, textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' },
  clearButton: { minWidth: 42, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' },
  textarea: { width: '100%', minHeight: 74, padding: 12, borderRadius: 10, border: '1px solid #cbd5e1', boxSizing: 'border-box' },
  grid2: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 },
  fieldBlock: { marginBottom: 16 },
  dropdown: { position: 'absolute', left: 0, right: 0, top: 'calc(100% + 8px)', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 12, padding: 8, maxHeight: 240, overflowY: 'auto', zIndex: 30, boxShadow: '0 12px 28px rgba(15,23,42,0.12)' },
  dropdownItem: { display: 'flex', gap: 8, padding: '8px 10px', alignItems: 'center' },
  dropdownEmpty: { padding: 12, color: '#64748b' },
  notesBox: { border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 16 },
  notesHeader: { display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#f8fafc' },
  notesList: { maxHeight: 220, overflowY: 'auto' },
  noteItem: { display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid #f1f5f9' },
  actionsColumn: { display: 'grid', gap: 10 },
  primaryButton: { padding: '12px 14px', borderRadius: 12, border: 'none', background: '#111827', color: '#fff', fontWeight: 700 },
  secondaryButton: { padding: '12px 14px', borderRadius: 12, border: '1px solid #111827', background: '#fff', color: '#111827', fontWeight: 700 },
  docaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginBottom: 16 },
  docaCard: { display: 'grid', gap: 4, textAlign: 'left', borderRadius: 14, border: '2px solid #d1d5db', background: '#fff', padding: 14 },
  docaDetail: { border: '1px solid #e5e7eb', borderRadius: 14, padding: 14 },
  queueCard: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12, background: '#fafafa' },
  queueHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 },
  queueMeta: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6, marginBottom: 12, fontSize: 13 },
  noteTableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse' }
};
