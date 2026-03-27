import QRCode from "qrcode";

export async function qrSvg(text) {
  return QRCode.toString(text, { type: "svg", margin: 1, width: 240 });
}
