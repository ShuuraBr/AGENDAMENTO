import QRCode from "qrcode";

function escapePdfText(value = "") {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function normalizeText(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E]/g, " ");
}

function textCmd(x, y, size, text) {
  return `BT /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(normalizeText(text))}) Tj ET`;
}

function wrapText(text, maxChars = 88) {
  const words = normalizeText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }

  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function buildQrCommands(qrText, x, y, size) {
  const qr = QRCode.create(qrText, { errorCorrectionLevel: "M", margin: 1 });
  const moduleCount = qr.modules.size;
  const moduleSize = size / moduleCount;
  const commands = ["0 g"];

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.modules.get(row, col)) {
        const rx = x + col * moduleSize;
        const ry = y + (moduleCount - row - 1) * moduleSize;
        commands.push(`${rx.toFixed(2)} ${ry.toFixed(2)} ${moduleSize.toFixed(2)} ${moduleSize.toFixed(2)} re f`);
      }
    }
  }

  return commands.join("\n");
}

function buildContent(agendamento, publicUrl) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const qrSize = 140;
  const qrX = pageWidth - margin - qrSize;
  const qrY = pageHeight - margin - qrSize - 120;

  const lines = [];
  lines.push("0.13 0.21 0.33 rg");
  lines.push(`${margin} ${pageHeight - 72} ${pageWidth - margin * 2} 36 re f`);
  lines.push("1 1 1 rg");
  lines.push(textCmd(margin + 14, pageHeight - 49, 18, `Voucher de Agendamento - ${agendamento.protocolo}`));
  lines.push("0 0 0 rg");
  lines.push(textCmd(margin, pageHeight - 96, 10, "Apresente este voucher ao operador do recebimento. QR Code valido para check-in."));

  const fields = [
    ["Status", agendamento.status],
    ["Fornecedor", agendamento.fornecedor],
    ["Transportadora", agendamento.transportadora],
    ["Motorista", agendamento.motorista],
    ["Token motorista", agendamento.publicTokenMotorista],
    ["Token consulta fornecedor", agendamento.publicTokenFornecedor],
    ["Placa", agendamento.placa],
    ["Data", agendamento.dataAgendada],
    ["Hora", agendamento.horaAgendada],
    ["Doca", agendamento.doca?.codigo || "A DEFINIR"],
    ["Janela", agendamento.janela?.codigo || "-"],
    ["Check-in", publicUrl]
  ];

  let y = pageHeight - 132;
  for (const [label, value] of fields) {
    lines.push(textCmd(margin, y, 10, `${label}: ${value || "-"}`));
    y -= 18;
  }

  lines.push(textCmd(margin, y - 8, 12, "Notas fiscais"));
  y -= 28;
  const notas = Array.isArray(agendamento.notasFiscais) && agendamento.notasFiscais.length ? agendamento.notasFiscais : [];
  if (!notas.length) {
    lines.push(textCmd(margin, y, 10, "Sem notas fiscais cadastradas."));
    y -= 18;
  } else {
    for (const nota of notas.slice(0, 6)) {
      const resumo = `NF ${nota.numeroNf || "-"} | Serie ${nota.serie || "-"} | Volumes ${nota.volumes || 0} | Chave ${nota.chaveAcesso || "-"}`;
      for (const line of wrapText(resumo, 78)) {
        lines.push(textCmd(margin, y, 9, line));
        y -= 14;
      }
      y -= 4;
    }
  }

  lines.push(textCmd(margin, 120, 11, "Orientacoes"));
  const orientacoes = [
    "Chegue com antecedencia minima de 15 minutos.",
    "Tenha a documentacao da carga disponivel.",
    "Em caso de imprevisto, o motorista pode cancelar ate 24h antes do horario agendado.",
    `Consulta publica: ${publicUrl}`
  ];
  let oy = 102;
  for (const item of orientacoes) {
    for (const line of wrapText(`- ${item}`, 88)) {
      lines.push(textCmd(margin, oy, 9, line));
      oy -= 13;
    }
  }

  lines.push(buildQrCommands(publicUrl, qrX, qrY, qrSize));
  lines.push(textCmd(qrX, qrY - 16, 9, "QR Code do check-in"));

  return lines.join("\n");
}

export function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const publicUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken)}`;
  const content = buildContent(agendamento, publicUrl);
  const contentBuffer = Buffer.from(content, "latin1");

  const objects = [];
  const pushObject = (body) => objects.push(body);

  pushObject("<< /Type /Catalog /Pages 2 0 R >>");
  pushObject("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  pushObject("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  pushObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pushObject(`<< /Length ${contentBuffer.length} >>\nstream\n${content}\nendstream`);

  const chunks = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];

  let totalLength = chunks[0].length;
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(totalLength);
    const objectBuffer = Buffer.from(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`, "latin1");
    chunks.push(objectBuffer);
    totalLength += objectBuffer.length;
  }

  const xrefOffset = totalLength;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }

  chunks.push(Buffer.from(xref, "latin1"));
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`, "latin1"));

  return Buffer.concat(chunks);
}
