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

function wrapText(text, maxChars = 80) {
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

function drawLogo(x, y, w, h) {
  const cmds = [];
  cmds.push("1 1 1 rg");
  cmds.push(`${x} ${y} ${w} ${h} re f`);
  cmds.push("0.95 0.74 0.11 rg");
  cmds.push(`${x + 8} ${y + 6} ${w - 16} ${h - 12} re f`);
  cmds.push("0.07 0.15 0.29 rg");
  cmds.push(textCmd(x + 16, y + h / 2 + 2, 10, "OBJETIVA"));
  cmds.push(textCmd(x + 16, y + h / 2 - 12, 8, "ATACADISTA"));
  return cmds.join("\n");
}

function buildContent(agendamento, links) {
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 40;
  const contentWidth = pageWidth - margin * 2;
  const qrSize = 118;
  const qrX = pageWidth - margin - qrSize;
  const qrY = pageHeight - margin - qrSize - 120;
  const lines = [];

  lines.push("0.07 0.15 0.29 rg");
  lines.push(`${margin} ${pageHeight - 90} ${contentWidth} 62 re f`);
  lines.push(drawLogo(margin + 14, pageHeight - 78, 110, 38));
  lines.push("1 1 1 rg");
  lines.push(textCmd(margin + 138, pageHeight - 50, 18, "Voucher de Recebimento"));
  lines.push(textCmd(margin + 138, pageHeight - 68, 10, `Protocolo ${agendamento.protocolo}`));

  lines.push("0 0 0 rg");
  lines.push("0.97 0.98 1 rg");
  lines.push(`${margin} ${pageHeight - 230} ${contentWidth} 120 re f`);
  lines.push("0.13 0.21 0.33 RG 1 w");
  lines.push(`${margin} ${pageHeight - 230} ${contentWidth} 120 re S`);

  lines.push(textCmd(margin + 14, pageHeight - 124, 11, "Dados do agendamento"));
  const leftFields = [
    ["Status", agendamento.status],
    ["Fornecedor", agendamento.fornecedor],
    ["Transportadora", agendamento.transportadora],
    ["Motorista", agendamento.motorista],
    ["CPF motorista", agendamento.motoristaCpf || "-"],
    ["Placa", agendamento.placa]
  ];
  const rightFields = [
    ["Data/Hora", `${agendamento.dataAgendada} ${agendamento.horaAgendada}`],
    ["Doca", agendamento.doca?.codigo || "A DEFINIR"],
    ["Janela", agendamento.janela?.codigo || "-"],
    ["Qtd. notas", agendamento.quantidadeNotas || 0],
    ["Volumes", agendamento.quantidadeVolumes || 0],
    ["Peso/Valor", `${agendamento.pesoTotal || 0} kg | R$ ${Number(agendamento.valorTotal || 0).toFixed(2)}`]
  ];

  let y = pageHeight - 146;
  for (const [label, value] of leftFields) {
    lines.push(textCmd(margin + 14, y, 9.3, `${label}: ${value || "-"}`));
    y -= 16;
  }
  y = pageHeight - 146;
  for (const [label, value] of rightFields) {
    lines.push(textCmd(margin + 280, y, 9.3, `${label}: ${value || "-"}`));
    y -= 16;
  }

  lines.push(textCmd(margin, pageHeight - 258, 11, "Instrucoes operacionais"));
  let oy = pageHeight - 278;
  [
    "Apresentar este voucher na portaria e no recebimento.",
    "O QR Code ao lado registra check-in. O QR de check-out sai no painel interno.",
    "Conferir motorista, CPF, veiculo, notas fiscais, volumes, peso e valor antes da descarga.",
    "A doca sera definida somente quando o agendamento estiver com status CHEGOU."
  ].forEach((item) => {
    wrapText(`- ${item}`, 84).forEach((line) => {
      lines.push(textCmd(margin, oy, 9, line));
      oy -= 12;
    });
  });

  lines.push(textCmd(margin, pageHeight - 354, 11, "Notas fiscais vinculadas"));
  let ny = pageHeight - 372;
  const notas = Array.isArray(agendamento.notasFiscais) ? agendamento.notasFiscais : [];
  if (!notas.length) {
    lines.push(textCmd(margin, ny, 9, "Sem notas fiscais cadastradas."));
    ny -= 14;
  } else {
    notas.slice(0, 8).forEach((nota) => {
      const resumo = `NF ${nota.numeroNf || "-"} | Serie ${nota.serie || "-"} | Volumes ${nota.volumes || 0} | Peso ${nota.peso || 0} | Valor ${Number(nota.valorNf || 0).toFixed(2)}`;
      wrapText(resumo, 84).forEach((line) => {
        lines.push(textCmd(margin, ny, 8.8, line));
        ny -= 12;
      });
      ny -= 2;
    });
  }

  lines.push(buildQrCommands(links.checkin, qrX, qrY, qrSize));
  lines.push(textCmd(qrX - 6, qrY - 16, 9, "QR Code de check-in"));
  lines.push(textCmd(margin, 110, 9.4, `Token motorista: ${agendamento.publicTokenMotorista}`));
  lines.push(textCmd(margin, 94, 9.4, `Link consulta: ${links.consulta}`));
  lines.push(textCmd(margin, 78, 9.4, `Link check-in: ${links.checkin}`));
  lines.push(textCmd(margin, 56, 8.6, "Documento emitido eletronicamente para controle operacional de recebimento."));
  return lines.join("\n");
}

export function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const links = {
    consulta: `${baseUrl}/?view=consulta&token=${encodeURIComponent(agendamento.publicTokenFornecedor)}`,
    checkin: `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken)}`
  };
  const content = buildContent(agendamento, links);
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
