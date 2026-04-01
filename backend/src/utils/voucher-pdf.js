import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';

function money(value = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function loadLogo() {
  const file = path.resolve('backend/public/assets/objetiva.png');
  return fs.existsSync(file) ? file : null;
}

async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, errorCorrectionLevel: 'M', width: 220 });
}

export async function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken || '')}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkoutToken || '')}`;
  const qrCheckin = await qrDataUrl(checkinUrl);
  const qrCheckout = await qrDataUrl(checkoutUrl);
  const logo = loadLogo();

  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  if (logo) doc.image(logo, 40, 32, { fit: [140, 55] });
  doc.rect(0, 0, doc.page.width, 110).fill('#0f2a4d');
  if (logo) doc.image(logo, 40, 26, { fit: [150, 60] });
  doc.fillColor('white').fontSize(22).text('Voucher Operacional de Agendamento', 220, 34, { align: 'right' });
  doc.fontSize(11).text(`Protocolo ${agendamento.protocolo || '-'}`, 220, 64, { align: 'right' });

  doc.fillColor('#0f172a');
  doc.roundedRect(40, 128, 515, 108, 12).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').fontSize(14).text('Dados principais', 56, 142);

  const fields = [
    ['Status', agendamento.status || '-'],
    ['Fornecedor', agendamento.fornecedor || '-'],
    ['Transportadora', agendamento.transportadora || '-'],
    ['Motorista', agendamento.motorista || '-'],
    ['CPF motorista', agendamento.cpfMotorista || '-'],
    ['Placa', agendamento.placa || '-'],
    ['Data', agendamento.dataAgendada || '-'],
    ['Hora', agendamento.horaAgendada || '-'],
    ['Doca', agendamento.doca?.codigo || agendamento.doca || 'A DEFINIR'],
    ['Janela', agendamento.janela?.codigo || agendamento.janela || '-'],
    ['Notas', String(agendamento.quantidadeNotas ?? 0)],
    ['Volumes', String(agendamento.quantidadeVolumes ?? 0)],
    ['Peso total', `${Number(agendamento.pesoTotalKg || 0).toLocaleString('pt-BR')} kg`],
    ['Valor total', money(agendamento.valorTotalNf || 0)]
  ];

  let x = 56, y = 168;
  fields.forEach((entry, idx) => {
    doc.fontSize(9).fillColor('#64748b').text(entry[0], x, y);
    doc.fontSize(11).fillColor('#0f172a').text(String(entry[1]), x, y + 13, { width: 210 });
    if (idx % 2 === 1) { x = 56; y += 32; } else { x = 300; }
  });

  doc.roundedRect(40, 256, 515, 150, 12).fillAndStroke('#ffffff', '#dbe2ea');
  doc.fillColor('#0f172a').fontSize(14).text('Notas fiscais e observações', 56, 272);
  const notas = Array.isArray(agendamento.notasFiscais) ? agendamento.notasFiscais : [];
  let ny = 298;
  if (!notas.length) {
    doc.fontSize(10).fillColor('#334155').text('Sem notas fiscais cadastradas.', 56, ny);
  } else {
    notas.slice(0, 7).forEach((nota) => {
      doc.fontSize(10).fillColor('#334155').text(`NF ${nota.numeroNf || '-'} | Série ${nota.serie || '-'} | Volumes ${nota.volumes || 0} | Peso ${nota.peso || 0} kg | Valor ${money(nota.valorNf || 0)}`, 56, ny, { width: 480 });
      ny += 18;
    });
  }
  if (agendamento.observacoes) {
    doc.fontSize(9).fillColor('#64748b').text('Observações', 56, 370);
    doc.fontSize(10).fillColor('#0f172a').text(String(agendamento.observacoes), 56, 384, { width: 480 });
  }

  doc.roundedRect(40, 430, 250, 320, 12).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.roundedRect(305, 430, 250, 320, 12).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').fontSize(14).text('QR Code de check-in', 68, 446);
  doc.fillColor('#0f172a').fontSize(14).text('QR Code de check-out', 332, 446);
  doc.image(qrCheckin, 78, 476, { fit: [170, 170] });
  doc.image(qrCheckout, 342, 476, { fit: [170, 170] });
  doc.fontSize(9).fillColor('#475569').text('Use este QR no recebimento para registrar a chegada.', 68, 660, { width: 180 });
  doc.fontSize(9).fillColor('#475569').text('Use este QR ao finalizar a operação e liberar a saída.', 332, 660, { width: 180 });
  doc.fontSize(8).fillColor('#64748b').text(checkinUrl, 68, 696, { width: 180 });
  doc.fontSize(8).fillColor('#64748b').text(checkoutUrl, 332, 696, { width: 180 });

  doc.end();
  return await new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
