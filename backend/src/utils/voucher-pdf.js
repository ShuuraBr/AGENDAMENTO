import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logoPath = path.resolve(__dirname, "../../public/assets/objetiva.png");

function asMoney(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function asWeight(value) {
  return `${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 3 })} kg`;
}

function line(doc, label, value, x, y, w) {
  doc.font("Helvetica-Bold").fontSize(9).text(label, x, y, { width: w });
  doc.font("Helvetica").fontSize(10).text(value || "-", x, y + 12, { width: w });
}

function card(doc, x, y, w, h, title, value) {
  doc.roundedRect(x, y, w, h, 10).fillAndStroke("#F6F8FB", "#D6DCE5");
  doc.fillColor("#5B6573").font("Helvetica-Bold").fontSize(8).text(title, x + 10, y + 10, { width: w - 20, align: "center" });
  doc.fillColor("#17212B").font("Helvetica-Bold").fontSize(13).text(value, x + 10, y + 26, { width: w - 20, align: "center" });
}

export async function generateVoucherPdf(agendamento, options = {}) {
  const baseUrl = options.baseUrl || `http://localhost:${process.env.PORT || 3000}`;
  const checkinUrl = `${baseUrl}/?view=checkin&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken)}`;
  const checkoutUrl = `${baseUrl}/?view=checkout&id=${encodeURIComponent(agendamento.id)}&token=${encodeURIComponent(agendamento.checkinToken)}`;
  const checkinQr = await QRCode.toDataURL(checkinUrl, { margin: 1, width: 180 });
  const checkoutQr = await QRCode.toDataURL(checkoutUrl, { margin: 1, width: 180 });

  const doc = new PDFDocument({ size: "A4", margin: 36 });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, doc.page.width, 96).fill("#10243A");
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, 36, 24, { fit: [110, 44] });
  }
  doc.fillColor("white").font("Helvetica-Bold").fontSize(22).text("Voucher de Agendamento", 160, 26);
  doc.font("Helvetica").fontSize(10).text(`Protocolo: ${agendamento.protocolo}`, 160, 56);
  doc.text(`Status atual: ${String(agendamento.status || "-").replaceAll("_", " ")}`, 160, 70);

  const topY = 116;
  const cardWidth = 120;
  card(doc, 36, topY, cardWidth, 58, "Notas", String(agendamento.quantidadeNotas ?? 0));
  card(doc, 170, topY, cardWidth, 58, "Volumes", String(agendamento.quantidadeVolumes ?? 0));
  card(doc, 304, topY, cardWidth, 58, "Peso total", asWeight(agendamento.pesoTotalKg));
  card(doc, 438, topY, cardWidth, 58, "Valor total", asMoney(agendamento.valorTotalNf));

  let y = 196;
  doc.fillColor("#17212B").font("Helvetica-Bold").fontSize(13).text("Dados do agendamento", 36, y);
  y += 20;
  doc.roundedRect(36, y, 523, 138, 12).stroke("#D6DCE5");
  line(doc, "Fornecedor", agendamento.fornecedor, 50, y + 16, 160);
  line(doc, "Transportadora", agendamento.transportadora, 220, y + 16, 160);
  line(doc, "Motorista", agendamento.motorista, 390, y + 16, 150);
  line(doc, "CPF do motorista", agendamento.cpfMotorista || "-", 50, y + 62, 160);
  line(doc, "Placa", agendamento.placa, 220, y + 62, 90);
  line(doc, "Data", agendamento.dataAgendada, 320, y + 62, 70);
  line(doc, "Hora", agendamento.horaAgendada, 400, y + 62, 60);
  line(doc, "Doca", agendamento.doca?.codigo || "A DEFINIR", 470, y + 62, 70);
  line(doc, "Janela", agendamento.janela?.codigo || "-", 50, y + 104, 220);
  line(doc, "Token motorista", agendamento.publicTokenMotorista, 220, y + 104, 320);

  y += 162;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#17212B").text("Notas fiscais", 36, y);
  y += 18;
  doc.roundedRect(36, y, 523, 168, 12).stroke("#D6DCE5");

  const notas = Array.isArray(agendamento.notasFiscais) ? agendamento.notasFiscais : [];
  let ny = y + 14;
  if (!notas.length) {
    doc.font("Helvetica").fontSize(10).fillColor("#5B6573").text("Nenhuma nota fiscal cadastrada.", 50, ny);
  } else {
    notas.slice(0, 8).forEach((nota, idx) => {
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#17212B").text(`NF ${idx + 1}`, 50, ny, { width: 40 });
      doc.font("Helvetica").fontSize(9)
        .text(`Número: ${nota.numeroNf || "-"}`, 90, ny, { width: 95 })
        .text(`Série: ${nota.serie || "-"}`, 190, ny, { width: 60 })
        .text(`Volumes: ${nota.volumes || 0}`, 260, ny, { width: 70 })
        .text(`Peso: ${asWeight(nota.peso)}`, 335, ny, { width: 90 })
        .text(`Valor: ${asMoney(nota.valorNf)}`, 430, ny, { width: 110 });
      ny += 18;
      if (nota.chaveAcesso) {
        doc.fillColor("#5B6573").fontSize(8).text(`Chave: ${nota.chaveAcesso}`, 90, ny, { width: 450 });
        ny += 14;
      }
      ny += 4;
    });
  }

  y += 188;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#17212B").text("Acesso operacional", 36, y);
  y += 20;
  doc.roundedRect(36, y, 250, 210, 12).stroke("#D6DCE5");
  doc.roundedRect(309, y, 250, 210, 12).stroke("#D6DCE5");
  doc.fillColor("#17212B").font("Helvetica-Bold").fontSize(12).text("Check-in", 36, y + 14, { width: 250, align: "center" });
  doc.fillColor("#17212B").font("Helvetica-Bold").fontSize(12).text("Check-out", 309, y + 14, { width: 250, align: "center" });
  doc.image(checkinQr, 80, y + 34, { fit: [160, 160] });
  doc.image(checkoutQr, 353, y + 34, { fit: [160, 160] });

  doc.addPage();
  doc.rect(0, 0, doc.page.width, 70).fill("#10243A");
  doc.fillColor("white").font("Helvetica-Bold").fontSize(18).text("Orientações do recebimento", 36, 26);
  doc.fillColor("#17212B").font("Helvetica").fontSize(11);
  const orientacoes = [
    "Apresente este voucher e os documentos da carga na portaria.",
    "O QR Code de check-in deve ser usado na chegada do veículo.",
    "O QR Code de check-out deve ser usado na saída, após a finalização operacional.",
    "Em caso de divergência de NF, peso, valor ou volumes, o operador deve revisar o agendamento antes de liberar a doca.",
    "A doca é definida operacionalmente conforme disponibilidade e status da chegada."
  ];
  let oy = 100;
  orientacoes.forEach((item, idx) => {
    doc.font("Helvetica-Bold").text(`${idx + 1}.`, 44, oy);
    doc.font("Helvetica").text(item, 64, oy, { width: 490 });
    oy += 34;
  });

  if (agendamento.observacoes) {
    doc.font("Helvetica-Bold").fontSize(13).text("Observações", 36, oy + 10);
    doc.roundedRect(36, oy + 32, 523, 120, 12).stroke("#D6DCE5");
    doc.font("Helvetica").fontSize(10).text(String(agendamento.observacoes), 50, oy + 48, { width: 495 });
  }

  doc.end();
  return done;
}
