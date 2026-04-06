import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';

function money(value = 0) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatNumberBR(value = 0, minimumFractionDigits = 0, maximumFractionDigits = 3) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits,
    maximumFractionDigits
  });
}

function formatWeightKg(value = 0) {
  return `${formatNumberBR(value, 3, 3)} kg`;
}

function formatCpf(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 11) return value || '-';
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatDateBR(value) {
  if (!value) return '-';
  const [year, month, day] = String(value).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
}

function loadLogo() {
  const file = path.resolve('backend/public/assets/objetiva.png');
  return fs.existsSync(file) ? file : null;
}

async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, errorCorrectionLevel: 'M', width: 220 });
}

function drawLabelValue(doc, label, value, x, y, width) {
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(label, x, y, { width });
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(String(value || '-'), x, y + 10, { width, lineGap: 1 });
}

function drawSectionTitle(doc, title, x, y) {
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(13).text(title, x, y);
}

export async function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinToken = agendamento.checkinToken || '';
  const checkoutToken = agendamento.checkoutToken || '';
  const checkinUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(checkinToken)}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(checkoutToken)}`;
  const qrCheckin = await qrDataUrl(checkinUrl);
  const qrCheckout = await qrDataUrl(checkoutUrl);
  const logo = loadLogo();

  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const pageWidth = doc.page.width;
  const contentWidth = pageWidth - 56;
  const summaryX = 28;

  doc.rect(0, 0, pageWidth, 84).fill('#0f2a4d');
  if (logo) doc.image(logo, 28, 16, { fit: [150, 46] });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('Voucher Operacional de Agendamento', 230, 18, { width: pageWidth - 258, align: 'right' });
  doc.font('Helvetica').fontSize(10).text(`Protocolo ${agendamento.protocolo || '-'}`, 230, 46, { width: pageWidth - 258, align: 'right' });

  const summaryY = 102;
  const summaryH = 258;
  doc.roundedRect(summaryX, summaryY, contentWidth, summaryH, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  drawSectionTitle(doc, 'Dados principais', summaryX + 16, summaryY + 14);

  const fields = [
    ['Status', agendamento.status || '-'],
    ['Fornecedor', agendamento.fornecedor || '-'],
    ['Transportadora', agendamento.transportadora || '-'],
    ['Motorista', agendamento.motorista || '-'],
    ['CPF do motorista', formatCpf(agendamento.cpfMotorista)],
    ['Placa', agendamento.placa || '-'],
    ['Data agendada', formatDateBR(agendamento.dataAgendada)],
    ['Hora', agendamento.horaAgendada || '-'],
    ['Doca', agendamento.doca?.codigo || agendamento.doca || 'A DEFINIR'],
    ['Janela', agendamento.janela?.codigo || agendamento.janela || '-'],
    ['Token do motorista', agendamento.publicTokenMotorista || '-'],
    ['Token do fornecedor', agendamento.publicTokenFornecedor || '-'],
    ['Quantidade de notas', formatNumberBR(agendamento.quantidadeNotas ?? 0, 0, 0)],
    ['Quantidade de volumes', formatNumberBR(agendamento.quantidadeVolumes || 0, 0, 3)],
    ['Peso total', formatWeightKg(agendamento.pesoTotalKg || 0)],
    ['Valor total', money(agendamento.valorTotalNf || 0)]
  ];

  const leftX = summaryX + 16;
  const rightX = summaryX + 278;
  let y = summaryY + 40;
  fields.forEach((entry, index) => {
    drawLabelValue(doc, entry[0], entry[1], index % 2 === 0 ? leftX : rightX, y, 230);
    if (index % 2 === 1) y += 28;
  });

  const notasY = 374;
  const notasH = 132;
  doc.roundedRect(summaryX, notasY, contentWidth, notasH, 14).fillAndStroke('#ffffff', '#dbe2ea');
  drawSectionTitle(doc, 'Notas fiscais e observações', summaryX + 16, notasY + 14);
  const notas = Array.isArray(agendamento.notasFiscais) ? agendamento.notasFiscais : [];
  let lineY = notasY + 38;
  if (!notas.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text('Sem notas fiscais cadastradas.', summaryX + 16, lineY, { width: contentWidth - 32 });
  } else {
    notas.slice(0, 5).forEach((nota) => {
      const linha = `NF ${nota.numeroNf || '-'} | Série ${nota.serie || '-'} | Vol. ${formatNumberBR(nota.volumes || 0, 0, 3)} | Peso ${formatWeightKg(nota.peso || 0)} | ${money(nota.valorNf || 0)}`;
      doc.font('Helvetica').fontSize(8.5).fillColor('#334155').text(linha, summaryX + 16, lineY, { width: contentWidth - 32, ellipsis: true });
      lineY += 15;
    });
    if (notas.length > 5) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#64748b').text(`+ ${notas.length - 5} NF adicionais no sistema.`, summaryX + 16, lineY, { width: contentWidth - 32 });
    }
  }
  if (agendamento.observacoes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('Observações', summaryX + 16, notasY + 95);
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a').text(String(agendamento.observacoes), summaryX + 16, notasY + 106, { width: contentWidth - 32, height: 18, ellipsis: true });
  }

  const qrY = 524;
  const boxWidth = 257;
  const boxHeight = 232;
  doc.roundedRect(summaryX, qrY, boxWidth, boxHeight, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.roundedRect(summaryX + 274, qrY, boxWidth, boxHeight, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  drawSectionTitle(doc, 'QR Code de check-in', summaryX + 16, qrY + 14);
  drawSectionTitle(doc, 'QR Code de check-out', summaryX + 290, qrY + 14);
  doc.image(qrCheckin, summaryX + 45, qrY + 40, { fit: [165, 165] });
  doc.image(qrCheckout, summaryX + 319, qrY + 40, { fit: [165, 165] });
  doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text('Use este QR no recebimento para registrar a chegada do veículo.', summaryX + 16, qrY + 176, { width: 220 });
  doc.text('Use este QR ao finalizar a operação e registrar a saída do veículo.', summaryX + 290, qrY + 176, { width: 220 });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text(`Token: ${checkinToken || '-'}`, summaryX + 16, qrY + 204, { width: 220 });
  doc.text(`Token: ${checkoutToken || '-'}`, summaryX + 290, qrY + 204, { width: 220 });
  doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(checkinUrl, summaryX + 16, qrY + 218, { width: 220, ellipsis: true });
  doc.text(checkoutUrl, summaryX + 290, qrY + 218, { width: 220, ellipsis: true });
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#0f172a').text('Orientações operacionais', summaryX, 772, { width: contentWidth });
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text('Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento.', summaryX, 785, { width: contentWidth });
  doc.end();
  return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}
