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

// ── Constantes de layout dos campos ─────────────────────────────────────────
const VALUE_FONT  = 9;     // fonte padrão — só reduz se uma palavra não couber na largura
const LABEL_FONT  = 8.5;
const MIN_FONT    = 7.5;   // mínimo absoluto (para tokens muito longos)
const MIN_BOX_H   = 22;    // altura mínima da caixa
const BOX_PAD_V   = 10;    // padding vertical total interno (5px cima + 5px baixo)
const BOX_PAD_H   = 7;     // padding horizontal interno
const LABEL_H     = 14;    // espaço acima da caixa para o label
const FIELD_GAP   = 6;     // espaço entre campos da mesma coluna

// Retorna { fontSize, boxH } para um campo.
// Reduz a fonte apenas o suficiente para que nenhuma palavra exceda textW
// (evita quebra de caractere forçada, que pdfkit não faz).
// boxH cresce automaticamente para acomodar as linhas com quebra automática.
function calcField(doc, value, textW) {
  const text  = String(value || '-');
  const words = text.split(/\s+/).filter(Boolean);
  let fontSize = VALUE_FONT;

  doc.font('Helvetica-Bold');
  while (fontSize > MIN_FONT) {
    doc.fontSize(fontSize);
    if (words.every(w => doc.widthOfString(w) <= textW)) break;
    fontSize -= 0.5;
  }
  doc.fontSize(fontSize);

  // Altura do texto com quebras de linha + buffer de segurança de 2px
  const textH = doc.heightOfString(text, { width: textW });
  const boxH  = Math.max(MIN_BOX_H, Math.ceil(textH) + BOX_PAD_V + 2);
  return { fontSize, boxH };
}

// Calcula a altura total de uma coluna sem renderizar (pré-calcula S1H)
function measureColumnH(doc, fields, colW) {
  const textW = colW - BOX_PAD_H * 2;
  return fields.reduce((acc, { value }, i) => {
    const { boxH } = calcField(doc, value, textW);
    return acc + LABEL_H + boxH + (i < fields.length - 1 ? FIELD_GAP : 0);
  }, 0);
}

// Renderiza uma coluna de campos.
// O texto é sempre clipado à área interna da caixa — nunca sobrepõe a borda.
function renderColumn(doc, fields, colX, colW, startY) {
  const textW = colW - BOX_PAD_H * 2;
  let y = startY;

  fields.forEach(({ label, value }, i) => {
    const text              = String(value || '-');
    const { fontSize, boxH } = calcField(doc, value, textW);
    const boxY              = y + LABEL_H;

    // Label
    doc.font('Helvetica').fontSize(LABEL_FONT).fillColor('#334155')
      .text(label, colX, y, { lineBreak: false });

    // Fundo da caixa
    doc.roundedRect(colX, boxY, colW, boxH, 4).fill('#f1f5f9');

    // Texto clipado à área interna — garante que não extravasa a borda
    doc.save();
    doc.rect(colX + 1, boxY + 1, colW - 2, boxH - 2).clip();
    doc.font('Helvetica-Bold').fontSize(fontSize).fillColor('#0f172a')
      .text(text, colX + BOX_PAD_H, boxY + 5, { width: textW, lineBreak: true });
    doc.restore();

    // Borda da caixa por cima (desenhada por último para ficar visível)
    doc.roundedRect(colX, boxY, colW, boxH, 4).stroke('#c5cdd8');

    y += LABEL_H + boxH + (i < fields.length - 1 ? FIELD_GAP : 0);
  });
  return y;
}

export async function generateVoucherPdf(agendamento, options = {}) {
  const normalized = normalizeVoucherAgendamento(agendamento);
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinToken  = normalized.checkinToken || '';
  const checkoutToken = normalized.checkoutToken || '';
  const checkinUrl  = `${baseUrl}/?view=checkin&id=${encodeURIComponent(normalized.id)}&token=${encodeURIComponent(checkinToken)}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(normalized.id)}&token=${encodeURIComponent(checkoutToken)}`;
  const qrCheckin  = await qrDataUrl(checkinUrl);
  const qrCheckout = await qrDataUrl(checkoutUrl);
  const logo = loadLogo();

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const W   = doc.page.width;   // 595.28
  const PAD = 28;
  const CW  = W - PAD * 2;     // 539.28

  // ── HEADER ──────────────────────────────────────────────────────────────────
  const HDR_H = 84;
  doc.rect(0, 0, W, HDR_H).fill('#0f2a4d');
  if (logo) doc.image(logo, PAD, 18, { fit: [148, 44] });

  const titleX = 238;
  const titleW = W - titleX - PAD;
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('Voucher de Agendamento', titleX, 15, { width: titleW, align: 'right', lineBreak: false });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(16)
    .text('de descarga', titleX, 35, { width: titleW, align: 'right', lineBreak: false });
  doc.fillColor('#cbd5e1').font('Helvetica-Bold').fontSize(9)
    .text(`Protocolo: ${normalized.protocolo || '-'}`, titleX, 60, { width: titleW, align: 'right', lineBreak: false });

  // ── SECTION 1: DADOS PRINCIPAIS ─────────────────────────────────────────────
  //
  // Fornecedor(es) — linha full-width no topo (evita desproporção nas colunas)
  //
  // Grid 3 colunas abaixo (5 / 4 / 5):
  //   Col 1: Status | Transportadora | CPF do motorista | Motorista | Placa
  //   Col 2: Data agendada | Hora | Janela | Doca
  //   Col 3: Token do motorista | Token do Fornecedor | Qtd Volumes | Qtd notas | Peso total
  //
  const INNER_X = PAD + 16;
  const INNER_W = CW - 32;
  const COL_GAP = 10;
  const COL_W   = Math.floor((INNER_W - COL_GAP * 2) / 3);  // ≈ 162
  const COL1X   = INNER_X;
  const COL2X   = INNER_X + COL_W + COL_GAP;
  const COL3X   = INNER_X + (COL_W + COL_GAP) * 2;

  // Fornecedor: campo único full-width — calcula altura antes de montar o card
  const fornecedorValue = normalized.fornecedor || '-';
  const { boxH: fornecedorBoxH } = calcField(doc, fornecedorValue, INNER_W - BOX_PAD_H * 2);
  const fornecedorRowH = LABEL_H + fornecedorBoxH + FIELD_GAP;  // label + box + gap abaixo

  // 3 colunas com distribuição equilibrada 5 / 4 / 5
  const col1Fields = [
    { label: 'Status',           value: normalized.status || '-' },
    { label: 'Transportadora',   value: normalized.transportadora || '-' },
    { label: 'CPF do motorista', value: formatCpf(normalized.cpfMotorista) },
    { label: 'Motorista',        value: normalized.motorista || '-' },
    { label: 'Placa',            value: normalized.placa || '-' },
  ];

  const col2Fields = [
    { label: 'Data agendada', value: formatDateBR(normalized.dataAgendada) },
    { label: 'Hora',          value: normalized.horaAgendada || '-' },
    { label: 'Janela',        value: normalized.janela?.codigo || normalized.janela || '-' },
    { label: 'Doca',          value: normalized.doca?.codigo || normalized.doca || 'A DEFINIR' },
  ];

  const col3Fields = [
    { label: 'Token do motorista',    value: normalized.publicTokenMotorista || '-' },
    { label: 'Token do Fornecedor',   value: normalized.publicTokenFornecedor || '-' },
    { label: 'Quantidade de Volumes', value: formatNumberBR(normalized.quantidadeVolumes || 0) },
    { label: 'Quantidade de notas',   value: String(normalized.quantidadeNotas ?? 0) },
    { label: 'Peso total',            value: formatWeightKg(normalized.pesoTotalKg || 0) },
  ];

  // Altura total da seção = título + fornecedor + grid colunas + padding
  const colH1 = measureColumnH(doc, col1Fields, COL_W);
  const colH2 = measureColumnH(doc, col2Fields, COL_W);
  const colH3 = measureColumnH(doc, col3Fields, COL_W);
  const gridH  = Math.max(colH1, colH2, colH3);
  const S1Y    = HDR_H + 14;
  const S1H    = 38 + fornecedorRowH + gridH + 16;

  doc.roundedRect(PAD, S1Y, CW, S1H, 10).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12)
    .text('Dados principais:', PAD + 16, S1Y + 14, { lineBreak: false });
  doc.moveTo(PAD + 16, S1Y + 34).lineTo(PAD + CW - 16, S1Y + 34)
    .strokeColor('#dbe2ea').lineWidth(0.8).stroke();

  // Renderiza Fornecedor(es) full-width
  const fornY = S1Y + 38;
  renderColumn(doc, [{ label: 'Fornecedor(es)', value: fornecedorValue }], INNER_X, INNER_W, fornY);

  // Renderiza grid 3 colunas abaixo do Fornecedor
  const fY = fornY + fornecedorRowH;
  renderColumn(doc, col1Fields, COL1X, COL_W, fY);
  renderColumn(doc, col2Fields, COL2X, COL_W, fY);
  renderColumn(doc, col3Fields, COL3X, COL_W, fY);

  // ── SECTION 2: NOTAS FISCAIS E OBSERVAÇÕES ──────────────────────────────────
  const S2Y = S1Y + S1H + 10;

  const notas = Array.isArray(normalized.notasFiscais) ? normalized.notasFiscais : [];
  const notasTexto = notas.length
    ? notas.map((n) => String(n?.numeroNf || '').trim()).filter(Boolean).join(' / ')
    : 'Sem notas fiscais cadastradas.';
  const obsTexto = String(normalized.observacoes || '-');

  const s2Fields = [
    { label: 'Notas fiscais:', value: notasTexto },
    { label: 'Observações:',   value: obsTexto },
  ];

  const S2ContentH = measureColumnH(doc, s2Fields, INNER_W);
  const S2H = 38 + S2ContentH + 16;

  doc.roundedRect(PAD, S2Y, CW, S2H, 10).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12)
    .text('Notas fiscais e Observações:', PAD + 16, S2Y + 14, { lineBreak: false });
  doc.moveTo(PAD + 16, S2Y + 34).lineTo(PAD + CW - 16, S2Y + 34)
    .strokeColor('#dbe2ea').lineWidth(0.8).stroke();

  renderColumn(doc, s2Fields, INNER_X, INNER_W, S2Y + 38);

  // ── SECTION 3: QR CODES ─────────────────────────────────────────────────────
  const S3Y = S2Y + S2H + 10;
  const QR_SIZE  = 132;
  const QR_BOX_W = Math.round((CW - 12) / 2);
  const QR_GAP   = CW - QR_BOX_W * 2;
  const QR_BOX_H = 32 + QR_SIZE + 8 + 20 + 14 + 10;  // = 216

  const lBoxX = PAD;
  const rBoxX = PAD + QR_BOX_W + QR_GAP;

  doc.roundedRect(lBoxX, S3Y, QR_BOX_W, QR_BOX_H, 10).fillAndStroke('#f8fafc', '#dbe2ea');
  doc.roundedRect(rBoxX, S3Y, QR_BOX_W, QR_BOX_H, 10).fillAndStroke('#f8fafc', '#dbe2ea');

  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11)
    .text('QR Code de check-in',  lBoxX + 14, S3Y + 12, { lineBreak: false });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11)
    .text('QR Code de check-out', rBoxX + 14, S3Y + 12, { lineBreak: false });

  const qrOff = Math.round((QR_BOX_W - QR_SIZE) / 2);
  doc.image(qrCheckin,  lBoxX + qrOff, S3Y + 32, { fit: [QR_SIZE, QR_SIZE] });
  doc.image(qrCheckout, rBoxX + qrOff, S3Y + 32, { fit: [QR_SIZE, QR_SIZE] });

  const descY  = S3Y + 32 + QR_SIZE + 8;
  const tokenY = descY + 20;
  const urlY   = tokenY + 14;

  doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
    .text('Use este QR no recebimento para registrar a chegada do veículo.',
      lBoxX + 14, descY, { width: QR_BOX_W - 28, height: 18, ellipsis: true });
  doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
    .text('Use este QR ao finalizar a operação e registrar a saída do veículo.',
      rBoxX + 14, descY, { width: QR_BOX_W - 28, height: 18, ellipsis: true });

  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a')
    .text(`Token: ${checkinToken  || '-'}`, lBoxX + 14, tokenY, { width: QR_BOX_W - 28, lineBreak: false });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0f172a')
    .text(`Token: ${checkoutToken || '-'}`, rBoxX + 14, tokenY, { width: QR_BOX_W - 28, lineBreak: false });

  doc.font('Helvetica').fontSize(6).fillColor('#94a3b8')
    .text(checkinUrl,  lBoxX + 14, urlY, { width: QR_BOX_W - 28, lineBreak: false, ellipsis: true });
  doc.font('Helvetica').fontSize(6).fillColor('#94a3b8')
    .text(checkoutUrl, rBoxX + 14, urlY, { width: QR_BOX_W - 28, lineBreak: false, ellipsis: true });

  // ── ORIENTAÇÕES OPERACIONAIS ─────────────────────────────────────────────────
  const ORIY = S3Y + QR_BOX_H + 14;
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10)
    .text('Orientações operacionais:', PAD, ORIY, { lineBreak: false });
  doc.fillColor('#475569').font('Helvetica').fontSize(8)
    .text(
      'Compareça com 10 minutos de antecedência e apresente este voucher na portaria ou no recebimento. O motorista deve estar utilizando EPI (botina, cinta lombar, luvas e, se necessário, capacete) e acompanhado de um auxiliar para descarregar.',
      PAD, ORIY + 14, { width: CW }
    );

  doc.end();
  return await new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
}