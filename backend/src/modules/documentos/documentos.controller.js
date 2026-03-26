import { prisma } from '../../config/prisma.js';

export async function uploadDocumento(req, res) {
  const agendamentoId = Number(req.params.id);
  if (!req.file) return res.status(400).json({ message: 'Arquivo não enviado' });

  const created = await prisma.documento.create({
    data: {
      agendamentoId,
      tipoDocumento: req.body.tipoDocumento || 'ANEXO',
      nomeArquivo: req.file.originalname,
      urlArquivo: req.file.filename,
      mimeType: req.file.mimetype,
      tamanhoBytes: req.file.size,
    },
  });

  res.status(201).json(created);
}

export async function listDocumentos(req, res) {
  const agendamentoId = Number(req.params.id);
  const items = await prisma.documento.findMany({ where: { agendamentoId }, orderBy: { createdAt: 'desc' } });
  res.json(items);
}
