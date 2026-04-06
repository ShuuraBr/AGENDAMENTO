export async function simulateVoucherDispatch(agendamento) {
  return {
    email: agendamento.fornecedor?.email || agendamento.transportadora?.email || null,
    whatsapp: agendamento.motorista?.whatsapp || agendamento.transportadora?.whatsapp || null,
    message: 'No MVP, o envio é simulado e registrado apenas na resposta da API.',
  };
}
