import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import QRCode from 'qrcode';

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
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = String(value.getUTCFullYear());
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${day}/${month}/${year}`;
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[1]}/${br[2]}/${br[3]}`;
  return raw || '-';
}

function parseJanelaCodigo(codigo = '') {
  const match = String(codigo || '').match(/(\d{2}:\d{2})(?:\s*[-–]\s*(\d{2}:\d{2}))?/);
  return match ? { horaInicio: match[1], horaFim: match[2] || '' } : { horaInicio: '', horaFim: '' };
}

function normalizeVoucherAgendamento(agendamento = {}) {
  const janelaCodigo = agendamento?.janela?.codigo || agendamento?.janela || '';
  const horaAgendada = String(agendamento?.horaAgendada || '').trim() || parseJanelaCodigo(janelaCodigo).horaInicio || '';
  return { ...agendamento, horaAgendada, dataAgendada: agendamento?.dataAgendada || '' };
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
  const normalized = normalizeVoucherAgendamento(agendamento);
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinToken = normalized.checkinToken || '';
  const checkoutToken = normalized.checkoutToken || '';
  const checkinUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(normalized.id)}&token=${encodeURIComponent(checkinToken)}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(normalized.id)}&token=${encodeURIComponent(checkoutToken)}`;
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
  doc.font('Helvetica').fontSize(10).text(`Protocolo ${normalized.protocolo || '-'}`, 230, 46, { width: pageWidth - 258, align: 'right' });

  const summaryY = 102;
  const summaryH = 258;
  doc.roundedRect(summaryX, summaryY, contentWidth, summaryH, 14).fillAndStroke('#f8fafc', '#dbe2ea');
  drawSectionTitle(doc, 'Dados principais', summaryX + 16, summaryY + 14);

  const fields = [
    ['Status', normalized.status || '-'],
    ['Fornecedor', normalized.fornecedor || '-'],
    ['Transportadora', normalized.transportadora || '-'],
    ['Motorista', normalized.motorista || '-'],
    ['CPF do motorista', formatCpf(normalized.cpfMotorista)],
    ['Placa', normalized.placa || '-'],
    ['Data agendada', formatDateBR(normalized.dataAgendada)],
    ['Hora', normalized.horaAgendada || '-'],
    ['Doca', normalized.doca?.codigo || normalized.doca || 'A DEFINIR'],
    ['Janela', normalized.janela?.codigo || normalized.janela || '-'],
    ['Token do motorista', normalized.publicTokenMotorista || '-'],
    ['Token do fornecedor', normalized.publicTokenFornecedor || '-'],
    ['Quantidade de notas', String(normalized.quantidadeNotas ?? 0)],
    ['Quantidade de volumes', formatNumberBR(normalized.quantidadeVolumes || 0, 0, 3)],
    ['Peso total', formatWeightKg(normalized.pesoTotalKg || 0)]
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
  const notas = Array.isArray(normalized.notasFiscais) ? normalized.notasFiscais : [];
  const notasTexto = notas.length
    ? notas.map((nota) => String(nota?.numeroNf || '').trim()).filter(Boolean).join(' / ')
    : 'Sem notas fiscais cadastradas.';
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('Notas fiscais', summaryX + 16, notasY + 38);
  doc.font('Helvetica').fontSize(9).fillColor('#0f172a').text(notasTexto, summaryX + 16, notasY + 50, { width: contentWidth - 32, height: 28, ellipsis: true });
  if (normalized.observacoes) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('Observações', summaryX + 16, notasY + 92);
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a').text(String(normalized.observacoes), summaryX + 16, notasY + 104, { width: contentWidth - 32, height: 18, ellipsis: true });
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
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text('Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento. O motorista deve estar utilizando EPI (botina, cinta lombar, luvas e, se necessário, capacete) e acompanhado de um auxiliar para descarregar.', summaryX, 785, { width: contentWidth });
  doc.end();
  return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}
