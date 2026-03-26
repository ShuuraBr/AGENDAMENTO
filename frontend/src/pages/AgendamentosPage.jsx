import { useEffect, useState } from 'react';
import Layout from '../components/Layout.jsx';
import api from '../services/api.js';

const initialForm = {
  unidadeId: '',
  docaId: '',
  fornecedorId: '',
  transportadoraId: '',
  motoristaId: '',
  veiculoId: '',
  dataAgendada: '',
  horaAgendada: '',
  quantidadeNotas: 0,
  quantidadeVolumes: 0,
  pesoTotalKg: '',
  valorTotalNf: '',
  observacoes: '',
};

const tiposDocumento = ['NF', 'ROMANEIO', 'MANIFESTO', 'CNH', 'OUTRO'];

function formatDate(value) {
  try { return new Date(value).toISOString().slice(0, 10); } catch { return '-'; }
}
function formatTime(value) {
  try { return new Date(value).toISOString().slice(11, 16); } catch { return '-'; }
}

export default function AgendamentosPage() {
  const [form, setForm] = useState(initialForm);
  const [agendamentos, setAgendamentos] = useState([]);
  const [bases, setBases] = useState({ unidades: [], docas: [], fornecedores: [], transportadoras: [], motoristas: [], veiculos: [] });
  const [approvalPreview, setApprovalPreview] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [documentoTipo, setDocumentoTipo] = useState('NF');
  const [documentoFile, setDocumentoFile] = useState(null);
  const [selectedDocuments, setSelectedDocuments] = useState([]);
  const [message, setMessage] = useState('');

  async function load() {
    const [ag, un, dc, fo, tr, mo, ve] = await Promise.all([
      api.get('/agendamentos'),
      api.get('/unidades'),
      api.get('/docas'),
      api.get('/fornecedores'),
      api.get('/transportadoras'),
      api.get('/motoristas'),
      api.get('/veiculos'),
    ]);
    setAgendamentos(ag.data);
    setBases({ unidades: un.data, docas: dc.data, fornecedores: fo.data, transportadoras: tr.data, motoristas: mo.data, veiculos: ve.data });
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selectedId) api.get(`/agendamentos/${selectedId}/documentos`).then((res) => setSelectedDocuments(res.data));
    else setSelectedDocuments([]);
  }, [selectedId]);

  async function previewApproval() {
    if (!form.unidadeId || !form.dataAgendada || !form.horaAgendada) return;
    const payload = {
      ...form,
      unidadeId: form.unidadeId || undefined,
      docaId: form.docaId || undefined,
      fornecedorId: form.fornecedorId || undefined,
      transportadoraId: form.transportadoraId || undefined,
      motoristaId: form.motoristaId || undefined,
      veiculoId: form.veiculoId || undefined,
    };
    const { data } = await api.post('/agendamentos/preview-approval', payload);
    setApprovalPreview(data);
  }

  async function submit(e) {
    e.preventDefault();
    const payload = {
      ...form,
      unidadeId: form.unidadeId || undefined,
      docaId: form.docaId || undefined,
      fornecedorId: form.fornecedorId || undefined,
      transportadoraId: form.transportadoraId || undefined,
      motoristaId: form.motoristaId || undefined,
      veiculoId: form.veiculoId || undefined,
    };
    const { data } = await api.post('/agendamentos', payload);
    setMessage(`Agendamento ${data.agendamento.protocolo} criado com status ${data.agendamento.status}.`);
    setApprovalPreview(data.approval);
    setForm(initialForm);
    load();
  }

  async function action(id, endpoint, body = {}) {
    await api.post(`/agendamentos/${id}/${endpoint}`, body);
    setMessage(`Ação ${endpoint} executada no agendamento ${id}.`);
    load();
    if (selectedId === String(id)) {
      const { data } = await api.get(`/agendamentos/${id}/documentos`);
      setSelectedDocuments(data);
    }
  }

  async function uploadDocumento(e) {
    e.preventDefault();
    if (!selectedId || !documentoFile) return;
    const fd = new FormData();
    fd.append('tipoDocumento', documentoTipo);
    fd.append('arquivo', documentoFile);
    await api.post(`/agendamentos/${selectedId}/documentos`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    setDocumentoFile(null);
    const input = document.getElementById('arquivo-documento');
    if (input) input.value = '';
    const { data } = await api.get(`/agendamentos/${selectedId}/documentos`);
    setSelectedDocuments(data);
    setMessage('Documento anexado com sucesso.');
  }

  async function sendVoucher(id) {
    const { data } = await api.post(`/agendamentos/${id}/enviar-voucher`);
    setMessage(`Envio simulado do voucher. E-mail: ${data.dispatch.email || '-'} | WhatsApp: ${data.dispatch.whatsapp || '-'}`);
  }

  function downloadVoucher(id) {
    const apiBase = import.meta.env.VITE_API_URL;
    const token = localStorage.getItem('token');
    window.open(`${apiBase}/agendamentos/${id}/voucher.pdf?token=${token}`, '_blank');
  }

  return (
    <Layout>
      <div className='page-title'><div><h2>Agendamentos</h2><div className='muted'>Criação, aprovação, documentos e voucher</div></div></div>
      {message ? <div className='notice'>{message}</div> : null}

      <div className='card'>
        <h3>Novo agendamento</h3>
        <form onSubmit={submit} className='grid'>
          <div className='form-grid'>
            <label>Unidade<select value={form.unidadeId} onChange={(e) => setForm({ ...form, unidadeId: e.target.value })} onBlur={previewApproval} required><option value=''>Selecione</option>{bases.unidades.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.nome}</option>)}</select></label>
            <label>Doca<select value={form.docaId} onChange={(e) => setForm({ ...form, docaId: e.target.value })} onBlur={previewApproval}><option value=''>Selecione</option>{bases.docas.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.codigo}</option>)}</select></label>
            <label>Fornecedor<select value={form.fornecedorId} onChange={(e) => setForm({ ...form, fornecedorId: e.target.value })} onBlur={previewApproval}><option value=''>Selecione</option>{bases.fornecedores.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.razaoSocial}</option>)}</select></label>
            <label>Transportadora<select value={form.transportadoraId} onChange={(e) => setForm({ ...form, transportadoraId: e.target.value })} onBlur={previewApproval}><option value=''>Selecione</option>{bases.transportadoras.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.razaoSocial}</option>)}</select></label>
            <label>Motorista<select value={form.motoristaId} onChange={(e) => setForm({ ...form, motoristaId: e.target.value })}><option value=''>Selecione</option>{bases.motoristas.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.nome}</option>)}</select></label>
            <label>Veículo<select value={form.veiculoId} onChange={(e) => setForm({ ...form, veiculoId: e.target.value })}><option value=''>Selecione</option>{bases.veiculos.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.placaCavalo || x.placaCarreta || x.tipoVeiculo}</option>)}</select></label>
            <label>Data<input type='date' value={form.dataAgendada} onChange={(e) => setForm({ ...form, dataAgendada: e.target.value })} onBlur={previewApproval} required /></label>
            <label>Hora<input type='time' value={form.horaAgendada} onChange={(e) => setForm({ ...form, horaAgendada: e.target.value })} onBlur={previewApproval} required /></label>
            <label>Quantidade de notas<input type='number' value={form.quantidadeNotas} onChange={(e) => setForm({ ...form, quantidadeNotas: e.target.value })} onBlur={previewApproval} /></label>
            <label>Quantidade de volumes<input type='number' value={form.quantidadeVolumes} onChange={(e) => setForm({ ...form, quantidadeVolumes: e.target.value })} onBlur={previewApproval} /></label>
            <label>Peso total (kg)<input value={form.pesoTotalKg} onChange={(e) => setForm({ ...form, pesoTotalKg: e.target.value })} onBlur={previewApproval} /></label>
            <label>Valor total NF<input value={form.valorTotalNf} onChange={(e) => setForm({ ...form, valorTotalNf: e.target.value })} /></label>
          </div>
          <label>Observações<textarea rows='3' value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>

          {approvalPreview ? <div className={`approval-box ${approvalPreview.autoApprove ? 'ok' : 'warn'}`}><strong>{approvalPreview.autoApprove ? 'Autoaprovação possível' : 'Exige aprovação manual'}</strong><ul>{approvalPreview.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}

          <div className='actions'><button type='submit'>Salvar agendamento</button></div>
        </form>
      </div>

      <div className='card' style={{ marginTop: 16 }}>
        <h3>Lista operacional</h3>
        <table className='table'><thead><tr><th>Protocolo</th><th>Data</th><th>Hora</th><th>Status</th><th>Fornecedor</th><th>Transportadora</th><th>Docs</th><th>Ações</th></tr></thead><tbody>{agendamentos.map((item) => <tr key={item.id.toString()}><td>{item.protocolo}</td><td>{formatDate(item.dataAgendada)}</td><td>{formatTime(item.horaAgendada)}</td><td><span className='badge'>{item.status}</span></td><td>{item.fornecedor?.razaoSocial || '-'}</td><td>{item.transportadora?.razaoSocial || '-'}</td><td>{item.documentos?.length || 0}</td><td><div className='actions wrap'><button className='success' onClick={() => action(item.id, 'aprovar', { force: true })}>Aprovar</button><button onClick={() => action(item.id, 'checkin')}>Check-in</button><button onClick={() => action(item.id, 'iniciar-descarga')}>Iniciar</button><button onClick={() => action(item.id, 'finalizar-descarga')}>Finalizar</button><button onClick={() => setSelectedId(item.id.toString())}>Documentos</button><button onClick={() => downloadVoucher(item.id)}>Voucher PDF</button><button onClick={() => sendVoucher(item.id)}>Enviar voucher</button><button className='danger' onClick={() => action(item.id, 'cancelar')}>Cancelar</button></div></td></tr>)}</tbody></table>
      </div>

      <div className='card' style={{ marginTop: 16 }}>
        <h3>Documentos do agendamento</h3>
        <div className='muted'>Selecione um agendamento na lista para anexar arquivos.</div>
        <div className='form-grid' style={{ marginTop: 12 }}>
          <label>Agendamento selecionado<select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}><option value=''>Selecione</option>{agendamentos.map((x) => <option key={x.id.toString()} value={x.id.toString()}>{x.protocolo}</option>)}</select></label>
          <label>Tipo do documento<select value={documentoTipo} onChange={(e) => setDocumentoTipo(e.target.value)}>{tiposDocumento.map((tipo) => <option key={tipo} value={tipo}>{tipo}</option>)}</select></label>
          <label>Arquivo<input id='arquivo-documento' type='file' onChange={(e) => setDocumentoFile(e.target.files?.[0] || null)} /></label>
        </div>
        <div className='actions' style={{ marginTop: 12 }}><button onClick={uploadDocumento} disabled={!selectedId || !documentoFile}>Anexar documento</button></div>
        <table className='table' style={{ marginTop: 16 }}><thead><tr><th>Tipo</th><th>Nome</th><th>Status</th><th>Arquivo</th></tr></thead><tbody>{selectedDocuments.map((doc) => <tr key={doc.id.toString()}><td>{doc.tipoDocumento}</td><td>{doc.nomeArquivo}</td><td>{doc.statusValidacao}</td><td><a href={doc.urlArquivo} target='_blank' rel='noreferrer'>Abrir</a></td></tr>)}{!selectedDocuments.length ? <tr><td colSpan='4'>Nenhum documento anexado.</td></tr> : null}</tbody></table>
      </div>
    </Layout>
  );
}
