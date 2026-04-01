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

function drawLabelValue(doc, label, value, x, y, width) {
  doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(label, x, y, { width });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(String(value || '-'), x, y + 11, { width });
}

export async function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken || '')}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkoutToken || '')}`;
  const qrCheckin = await qrDataUrl(checkinUrl);
  const qrCheckout = await qrDataUrl(checkoutUrl);
  const logo = loadLogo();

  const doc = new PDFDocument({ size: 'A4', margin: 32 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  doc.rect(0, 0, doc.page.width, 92).fill('#0f2a4d');
  if (logo) doc.image(logo, 34, 20, { fit: [150, 52] });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('Voucher Operacional de Agendamento', 220, 22, { align: 'right' });
  doc.font('Helvetica').fontSize(11).text(`Protocolo ${agendamento.protocolo || '-'}`, 220, 52, { align: 'right' });

  const topY = 112;
  doc.roundedRect(32, topY, 531, 210, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Dados principais', 48, topY + 16);

  const fields = [
    ['Status', agendamento.status || '-'],
    ['Fornecedor', agendamento.fornecedor || '-'],
    ['Transportadora', agendamento.transportadora || '-'],
    ['Motorista', agendamento.motorista || '-'],
    ['CPF do motorista', agendamento.cpfMotorista || '-'],
    ['Placa', agendamento.placa || '-'],
    ['Data agendada', agendamento.dataAgendada || '-'],
    ['Hora', agendamento.horaAgendada || '-'],
    ['Doca', agendamento.doca?.codigo || agendamento.doca || 'A DEFINIR'],
    ['Janela', agendamento.janela?.codigo || agendamento.janela || '-'],
    ['Token do motorista', agendamento.publicTokenMotorista || '-'],
    ['Token do fornecedor/consulta', agendamento.publicTokenFornecedor || '-'],
    ['Notas', String(agendamento.quantidadeNotas ?? 0)],
    ['Volumes', Number(agendamento.quantidadeVolumes || 0).toFixed(3)],
    ['Peso total', `${Number(agendamento.pesoTotalKg || 0).toFixed(3)} kg`],
    ['Valor total', money(agendamento.valorTotalNf || 0)]
  ];

  let x = 48;
  let y = topY + 44;
  fields.forEach((entry, idx) => {
    drawLabelValue(doc, entry[0], entry[1], x, y, 220);
    if (idx % 2 === 1) { x = 48; y += 40; } else { x = 315; }
  });

  const notasY = 340;
  doc.roundedRect(32, notasY, 531, 165, 14).fillAndStroke('#ffffff', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('Notas fiscais e observações', 48, notasY + 16);
  const notas = Array.isArray(agendamento.notasFiscais) ? agendamento.notasFiscais : [];
  let lineY = notasY + 44;
  if (!notas.length) {
    doc.font('Helvetica').fontSize(10).fillColor('#334155').text('Sem notas fiscais cadastradas.', 48, lineY);
  } else {
    notas.slice(0, 8).forEach((nota) => {
      const linha = `NF ${nota.numeroNf || '-'} | Série ${nota.serie || '-'} | Volumes ${Number(nota.volumes || 0).toFixed(3)} | Peso ${Number(nota.peso || 0).toFixed(3)} kg | Valor ${money(nota.valorNf || 0)}`;
      doc.font('Helvetica').fontSize(9).fillColor('#334155').text(linha, 48, lineY, { width: 495 });
      lineY += 16;
    });
  }
  if (agendamento.observacoes) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('Observações', 48, notasY + 126);
    doc.font('Helvetica').fontSize(10).fillColor('#0f172a').text(String(agendamento.observacoes), 48, notasY + 139, { width: 495 });
  }

  const qrY = 525;
  doc.roundedRect(32, qrY, 255, 250, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.roundedRect(308, qrY, 255, 250, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(14).text('QR Code de check-in', 48, qrY + 16);
  doc.text('QR Code de check-out', 324, qrY + 16);
  doc.image(qrCheckin, 72, qrY + 46, { fit: [170, 170] });
  doc.image(qrCheckout, 348, qrY + 46, { fit: [170, 170] });
  doc.font('Helvetica').fontSize(9).fillColor('#475569').text('Use este QR no recebimento para registrar a chegada.', 48, qrY + 196, { width: 210 });
  doc.text('Use este QR ao finalizar a operação e liberar a saída.', 324, qrY + 196, { width: 210 });
  doc.fontSize(7).fillColor('#64748b').text(checkinUrl, 48, qrY + 225, { width: 210 });
  doc.text(checkoutUrl, 324, qrY + 225, { width: 210 });

  doc.end();
  return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}
