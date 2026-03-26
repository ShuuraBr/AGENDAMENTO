import PDFDocument from 'pdfkit';

function writeLine(doc, label, value) {
  doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(value ?? '-');
}

export function generateVoucherPdf(agendamento) {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const chunks = [];

  return new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).font('Helvetica-Bold').text('Voucher de Agendamento de Descarga');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text('Documento gerado automaticamente pelo MVP.');

    doc.moveDown();
    writeLine(doc, 'Protocolo', agendamento.protocolo);
    writeLine(doc, 'Status', agendamento.status);
    writeLine(doc, 'Data', agendamento.dataAgendada?.toISOString?.().slice(0, 10));
    writeLine(doc, 'Hora', agendamento.horaAgendada?.toISOString?.().slice(11, 16));
    writeLine(doc, 'Unidade', agendamento.unidade?.nome);
    writeLine(doc, 'Doca', agendamento.doca?.codigo);
    writeLine(doc, 'Fornecedor', agendamento.fornecedor?.razaoSocial);
    writeLine(doc, 'Transportadora', agendamento.transportadora?.razaoSocial);
    writeLine(doc, 'Motorista', agendamento.motorista?.nome);
    writeLine(doc, 'Veículo', agendamento.veiculo?.placaCavalo || agendamento.veiculo?.placaCarreta || agendamento.veiculo?.tipoVeiculo);
    writeLine(doc, 'Qtd. notas', String(agendamento.quantidadeNotas ?? 0));
    writeLine(doc, 'Qtd. volumes', String(agendamento.quantidadeVolumes ?? 0));
    writeLine(doc, 'Peso total (kg)', agendamento.pesoTotalKg?.toString?.() ?? '-');
    writeLine(doc, 'Valor total NF', agendamento.valorTotalNf?.toString?.() ?? '-');

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Orientações operacionais');
    doc.font('Helvetica').list([
      'Apresente este voucher na portaria/recebimento.',
      'Chegue com antecedência mínima de 15 minutos.',
      'Mantenha documentos da carga disponíveis.',
      'A descarga poderá ser reprogramada em caso de divergência documental.',
    ]);

    doc.moveDown();
    doc.font('Helvetica-Bold').text('Observações');
    doc.font('Helvetica').text(agendamento.observacoes || 'Sem observações.');

    doc.end();
  });
}
