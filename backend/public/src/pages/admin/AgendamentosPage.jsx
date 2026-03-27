import { useEffect, useState } from 'react';
import { api } from '../../services/api';

export default function AgendamentosPage() {
  const [items, setItems] = useState([]);

  async function load() {
    const { data } = await api.get('/agendamentos');
    setItems(data);
  }

  useEffect(() => { load(); }, []);

  async function aprovar(id) {
    await api.post(`/agendamentos/${id}/aprovar`);
    load();
  }

  async function baixarVoucher(id) {
    const response = await api.get(`/agendamentos/${id}/voucher`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'voucher.pdf';
    link.click();
  }

  async function enviarVoucher(id) {
    const { data } = await api.post(`/agendamentos/${id}/enviar-voucher`);
    alert(JSON.stringify(data, null, 2));
  }

  return (
    <div style={{ padding: 24 }}>
      <h1>Agendamentos</h1>
      <table border="1" cellPadding="8">
        <thead>
          <tr>
            <th>Protocolo</th>
            <th>Status</th>
            <th>Data</th>
            <th>Hora</th>
            <th>Fornecedor</th>
            <th>Transportadora</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.protocolo}</td>
              <td>{item.status}</td>
              <td>{new Date(item.dataAgendada).toLocaleDateString('pt-BR')}</td>
              <td>{item.horaAgendada}</td>
              <td>{item.fornecedor?.razaoSocial || '-'}</td>
              <td>{item.transportadora?.razaoSocial || '-'}</td>
              <td>
                <button onClick={() => aprovar(item.id)}>Aprovar</button>{' '}
                <button onClick={() => baixarVoucher(item.id)}>Voucher</button>{' '}
                <button onClick={() => enviarVoucher(item.id)}>Enviar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
