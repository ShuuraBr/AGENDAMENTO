import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../services/api';

export default function PublicMotoristaPage() {
  const { protocolo } = useParams();
  const [item, setItem] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api.get(`/public/voucher/${protocolo}`).then((res) => setItem(res.data)).catch(() => setMessage('Protocolo não encontrado'));
  }, [protocolo]);

  async function confirmarChegada() {
    await api.post(`/public/motorista/${protocolo}/confirmar-chegada`);
    setMessage('Chegada confirmada com sucesso.');
  }

  if (!item) return <div style={{ padding: 24 }}>{message || 'Carregando...'}</div>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Voucher do motorista</h1>
      <p>Protocolo: {item.protocolo}</p>
      <p>Status: {item.status}</p>
      <p>Data: {new Date(item.dataAgendada).toLocaleDateString('pt-BR')}</p>
      <p>Hora: {item.horaAgendada}</p>
      <button onClick={confirmarChegada}>Confirmar chegada</button>
      {message && <p>{message}</p>}
    </div>
  );
}
