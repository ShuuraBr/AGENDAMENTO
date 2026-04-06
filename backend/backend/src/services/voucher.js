import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";

export async function generateVoucherPdf(agendamento) {
  const dir = path.resolve("uploads", "vouchers");
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `voucher-${agendamento.protocolo}.pdf`);
  const doc = new PDFDocument({ margin: 40 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(20).text("Voucher de Agendamento de Descarga", { align: "center" });
  doc.moveDown();
  doc.fontSize(12);
  doc.text(`Protocolo: ${agendamento.protocolo}`);
  doc.text(`Status: ${agendamento.status}`);
  doc.text(`Data: ${new Date(agendamento.dataAgendada).toLocaleDateString("pt-BR")}`);
  doc.text(`Hora: ${agendamento.horaAgendada}`);
  doc.text(`Unidade: ${agendamento.unidade?.nome || "-"}`);
  doc.text(`Doca: ${agendamento.doca?.codigo || "-"}`);
  doc.text(`Fornecedor: ${agendamento.fornecedor?.razaoSocial || "-"}`);
  doc.text(`Transportadora: ${agendamento.transportadora?.razaoSocial || "-"}`);
  doc.text(`Motorista: ${agendamento.motorista?.nome || "-"}`);
  doc.text(`Placa: ${agendamento.veiculo?.placaCavalo || "-"}`);
  doc.moveDown();
  doc.text("Apresente este voucher no acesso da unidade.");
  doc.end();

  await new Promise((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });

  return filePath;
}
