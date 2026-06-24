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
    const year = String(value.getFullYear());
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
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
  const rawHoraValue = agendamento?.horaAgendada;
  let horaFromField = '';
  if (rawHoraValue instanceof Date && !Number.isNaN(rawHoraValue.getTime())) {
    horaFromField = `${String(rawHoraValue.getHours()).padStart(2, '0')}:${String(rawHoraValue.getMinutes()).padStart(2, '0')}`;
  } else {
    const matchHora = String(rawHoraValue || '').trim().match(/^(\d{2}:\d{2})/);
    horaFromField = matchHora ? matchHora[1] : '';
  }
  const horaAgendada = horaFromField || parseJanelaCodigo(janelaCodigo).horaInicio || '';
  return { ...agendamento, horaAgendada, dataAgendada: agendamento?.dataAgendada || '' };
}

function loadLogo() {
  const file = path.resolve('backend/public/assets/objetiva.png');
  return fs.existsSync(file) ? file : null;
}

async function qrDataUrl(text) {
  return QRCode.toDataURL(text, { margin: 1, errorCorrectionLevel: 'M', width: 220 });
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

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const W = doc.page.width;   // 595.28
  const PAD = 28;
  const CW = W - PAD * 2;    // 539.28

  // ── HEADER ──────────────────────────────────────────────────────────────────
  const HDR_H = 90;
  doc.rect(0, 0, W, HDR_H).fill('#0f2a4d');

  if (logo) doc.image(logo, PAD, 20, { fit: [148, 44] });

  // Title: two explicit lines to prevent accidental wrapping collision
  const titleX = 238;
  const titleW = W - titleX - PAD;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('Voucher Operacional de', titleX, 18, { width: titleW, align: 'right', lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('Agendamento', titleX, 38, { width: titleW, align: 'right', lineBreak: false });
  doc.fillColor('#cbd5e1').font('Helvetica').fontSize(8.5)
    .text(`Protocolo: ${normalized.protocolo || '-'}`, titleX, 64, { width: titleW, align: 'right', lineBreak: false });

  // ── SECTION 1: DADOS PRINCIPAIS ─────────────────────────────────────────────
  //
  // 15 campos em grid 2 colunas, 8 linhas (7 pares + 1 solo)
  // ROW_H = 32px → garante espaço para label + valor sem sobrepor
  //
  const ROW_H = 32;
  const FIELD_ROWS = 8; // ceil(15/2)
  const S1Y = HDR_H + 14;
  const S1H = 48 + FIELD_ROWS * ROW_H + 10; // = 314

  doc.roundedRect(PAD, S1Y, CW, S1H, 10).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12)
    .text('Dados principais', PAD + 16, S1Y + 14, { lineBreak: false });
  doc.moveTo(PAD + 16, S1Y + 35).lineTo(PAD + CW - 16, S1Y + 35)
    .strokeColor('#dbe2ea').lineWidth(0.8).stroke();

  const COL1X = PAD + 16;
  const COL2X = PAD + Math.round(CW / 2) + 6;
  const COL_W = Math.round(CW / 2) - 22;

  const fields = [
    ['Status',                 normalized.status || '-'],
    ['Fornecedor',             normalized.fornecedor || '-'],
    ['Transportadora',         normalized.transportadora || '-'],
    ['Motorista',              normalized.motorista || '-'],
    ['CPF do motorista',       formatCpf(normalized.cpfMotorista)],
    ['Placa',                  normalized.placa || '-'],
    ['Data agendada',          formatDateBR(normalized.dataAgendada)],
    ['Hora',                   normalized.horaAgendada || '-'],
    ['Doca',                   normalized.doca?.codigo || normalized.doca || 'A DEFINIR'],
    ['Janela',                 normalized.janela?.codigo || normalized.janela || '-'],
    ['Token do motorista',     normalized.publicTokenMotorista || '-'],
    ['Token do fornecedor',    normalized.publicTokenFornecedor || '-'],
    ['Quantidade de notas',    String(normalized.quantidadeNotas ?? 0)],
    ['Quantidade de volumes',  formatNumberBR(normalized.quantidadeVolumes || 0, 0, 3)],
    ['Peso total',             formatWeightKg(normalized.pesoTotalKg || 0)]
  ];

  let fY = S1Y + 44;
  fields.forEach((entry, index) => {
    const x = index % 2 === 0 ? COL1X : COL2X;
    doc.font('Helvetica').fontSize(7).fillColor('#64748b')
      .text(entry[0], x, fY, { width: COL_W, lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0f172a')
      .text(String(entry[1] || '-'), x, fY + 10, { width: COL_W, lineBreak: false, ellipsis: true });
    if (index % 2 === 1) fY += ROW_H;
  });

  // ── SECTION 2: NOTAS FISCAIS E OBSERVAÇÕES ──────────────────────────────────
  const S2Y = S1Y + S1H + 12;
  const S2H = 118;
  doc.roundedRect(PAD, S2Y, CW, S2H, 10).fillAndStroke('#ffffff', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12)
    .text('Notas fiscais e observações', PAD + 16, S2Y + 14, { lineBreak: false });
  doc.moveTo(PAD + 16, S2Y + 35).lineTo(PAD + CW - 16, S2Y + 35)
    .strokeColor('#dbe2ea').lineWidth(0.8).stroke();

  const notas = Array.isArray(normalized.notasFiscais) ? normalized.notasFiscais : [];
  const notasTexto = notas.length
    ? notas.map((nota) => String(nota?.numeroNf || '').trim()).filter(Boolean).join(' / ')
    : 'Sem notas fiscais cadastradas.';

  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b')
    .text('Notas fiscais', PAD + 16, S2Y + 42, { lineBreak: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a')
    .text(notasTexto, PAD + 16, S2Y + 54, { width: CW - 32, height: 24, ellipsis: true });

  if (normalized.observacoes) {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#64748b')
      .text('Observações', PAD + 16, S2Y + 82, { lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a')
      .text(String(normalized.observacoes), PAD + 16, S2Y + 94, { width: CW - 32, height: 18, ellipsis: true });
  }

  // ── SECTION 3: QR CODES ─────────────────────────────────────────────────────
  const S3Y = S2Y + S2H + 12;
  const QR_SIZE = 142;
  const QR_BOX_W = Math.round((CW - 12) / 2); // ~263
  const QR_BOX_H = 34 + QR_SIZE + 6 + 22 + 16 + 10; // = 230
  const QR_GAP = CW - QR_BOX_W * 2; // ~13

  const leftBoxX = PAD;
  const rightBoxX = PAD + QR_BOX_W + QR_GAP;

  doc.roundedRect(leftBoxX, S3Y, QR_BOX_W, QR_BOX_H, 10).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.roundedRect(rightBoxX, S3Y, QR_BOX_W, QR_BOX_H, 10).fillAndStroke('#f8fafc', '#dbe2ea');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11)
    .text('QR Code de check-in', leftBoxX + 14, S3Y + 12, { lineBreak: false });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11)
    .text('QR Code de check-out', rightBoxX + 14, S3Y + 12, { lineBreak: false });

  const qrImgOffset = Math.round((QR_BOX_W - QR_SIZE) / 2);
  doc.image(qrCheckin,  leftBoxX  + qrImgOffset, S3Y + 34, { fit: [QR_SIZE, QR_SIZE] });
  doc.image(qrCheckout, rightBoxX + qrImgOffset, S3Y + 34, { fit: [QR_SIZE, QR_SIZE] });

  const descY  = S3Y + 34 + QR_SIZE + 6;
  const tokenY = descY + 22;
  const urlY   = tokenY + 16;

  doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
    .text('Use este QR no recebimento para registrar a chegada do veículo.',
      leftBoxX + 14, descY, { width: QR_BOX_W - 28, height: 20, ellipsis: true });
  doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
    .text('Use este QR ao finalizar a operação e registrar a saída do veículo.',
      rightBoxX + 14, descY, { width: QR_BOX_W - 28, height: 20, ellipsis: true });

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a')
    .text(`Token: ${checkinToken || '-'}`, leftBoxX + 14, tokenY, { width: QR_BOX_W - 28, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a')
    .text(`Token: ${checkoutToken || '-'}`, rightBoxX + 14, tokenY, { width: QR_BOX_W - 28, lineBreak: false });

  doc.font('Helvetica').fontSize(6).fillColor('#94a3b8')
    .text(checkinUrl,  leftBoxX + 14, urlY, { width: QR_BOX_W - 28, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(6).fillColor('#94a3b8')
    .text(checkoutUrl, rightBoxX + 14, urlY, { width: QR_BOX_W - 28, lineBreak: false, ellipsis: true });

  // ── ORIENTAÇÕES OPERACIONAIS ─────────────────────────────────────────────────
  const ORIY = S3Y + QR_BOX_H + 14;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10)
    .text('Orientações operacionais', PAD, ORIY, { lineBreak: false });
  doc.fillColor('#475569').font('Helvetica').fontSize(8)
    .text(
      'Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento. O motorista deve estar utilizando EPI (botina, cinta lombar, luvas e, se necessário, capacete) e acompanhado de um auxiliar para descarregar.',
      PAD, ORIY + 15, { width: CW }
    );

  doc.end();
  return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}