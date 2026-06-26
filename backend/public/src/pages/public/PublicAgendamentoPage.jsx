import { useState } from 'react';
import { api } from '../../services/api';

export default function PublicAgendamentoPage() {
  const [form, setForm] = useState({
    unidadeId: 1,
    dataAgendada: '',
    horaAgendada: '',
    quantidadeNotas: 0,
    quantidadeVolumes: 0,
    observacoes: '',
  });
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const { data } = await api.post('/public/agendamentos', form);
      setMessage(`Solicitação enviada. Protocolo: ${data.protocolo}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '24px auto' }}>
      <h1>Solicitar agendamento</h1>
      <form onSubmit={onSubmit}>
        <input type="date" value={form.dataAgendada} onChange={(e) => setForm({ ...form, dataAgendada: e.target.value })} required />
        <br /><br />
        <input type="time" value={form.horaAgendada} onChange={(e) => setForm({ ...form, horaAgendada: e.target.value })} required />
        <br /><br />
        <input type="number" placeholder="Quantidade de notas" value={form.quantidadeNotas} onChange={(e) => setForm({ ...form, quantidadeNotas: e.target.value })} />
        <br /><br />
        <input type="number" placeholder="Quantidade de volumes" value={form.quantidadeVolumes} onChange={(e) => setForm({ ...form, quantidadeVolumes: e.target.value })} />
        <br /><br />
        <textarea placeholder="Observações" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
        <br /><br />
        <button type="submit" disabled={sending}>{sending ? 'Enviando...' : 'Enviar solicitação'}</button>
      </form>
      {message && <p>{message}</p>}
    </div>
  );
}
