import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';

export async function generateVoucherPdf(agendamento, outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(outputPath);

    doc.pipe(stream);
    doc.fontSize(18).text('Voucher de Agendamento de Descarga', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Protocolo: ${agendamento.protocolo}`);
    doc.text(`Status: ${agendamento.status}`);
    doc.text(`Data: ${new Date(agendamento.dataAgendada).toLocaleDateString('pt-BR')}`);
    doc.text(`Hora: ${agendamento.horaAgendada}`);
    doc.text(`Fornecedor: ${agendamento.fornecedor?.razaoSocial || '-'}`);
    doc.text(`Transportadora: ${agendamento.transportadora?.razaoSocial || '-'}`);
    doc.text(`Motorista: ${agendamento.motorista?.nome || '-'}`);
    doc.text(`Telefone motorista: ${agendamento.motorista?.telefone || '-'}`);
    doc.text(`Veículo: ${agendamento.veiculo?.placaCavalo || '-'} / ${agendamento.veiculo?.placaCarreta || '-'}`);
    doc.text(`Volumes: ${agendamento.quantidadeVolumes}`);
    doc.text(`Notas: ${agendamento.quantidadeNotas}`);
    doc.text(`Observações: ${agendamento.observacoes || '-'}`);
    doc.moveDown();
    doc.text('Apresentar este voucher na portaria ou no recebimento.', { align: 'left' });
    doc.end();

    stream.on('finish', () => resolve(outputPath));
    stream.on('error', reject);
  });
}
