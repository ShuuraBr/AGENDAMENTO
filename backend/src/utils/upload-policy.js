import multer from 'multer';
import fs from 'fs';
import path from 'path';

export const AVARIA_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif'
];

export const AVARIA_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
export const AVARIA_IMAGE_MAX_COUNT = Math.max(1, Number(process.env.AVARIA_IMAGE_MAX_COUNT || 10));
export const AVARIA_IMAGE_MAX_BYTES = Math.max(1024 * 1024, Number(process.env.AVARIA_IMAGE_MAX_BYTES || 5 * 1024 * 1024));

function sanitizeFilename(filename = '') {
  return String(filename || 'arquivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ensureUploadDir(subdir = '') {
  const target = path.resolve(process.cwd(), 'uploads', subdir);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function createStorage(subdir = '') {
  const destinationDir = ensureUploadDir(subdir);
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destinationDir),
    filename: (_req, file, cb) => {
      const safeName = sanitizeFilename(file?.originalname || 'arquivo');
      cb(null, `${Date.now()}-${safeName || 'arquivo'}`);
    }
  });
}

function createImageFileFilter({ allowedMimeTypes, allowedExtensions }) {
  return (_req, file, cb) => {
    const mime = String(file?.mimetype || '').trim().toLowerCase();
    const ext = path.extname(String(file?.originalname || '')).trim().toLowerCase();
    if (!allowedMimeTypes.includes(mime) || !allowedExtensions.includes(ext)) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file?.fieldname || 'arquivo'));
    }
    cb(null, true);
  };
}

export function createDocumentUpload() {
  return multer({
    storage: createStorage('documentos')
  });
}

export function createAvariaImageUpload() {
  return multer({
    storage: createStorage('avarias'),
    fileFilter: createImageFileFilter({
      allowedMimeTypes: AVARIA_ALLOWED_MIME_TYPES,
      allowedExtensions: AVARIA_ALLOWED_EXTENSIONS
    }),
    limits: {
      fileSize: AVARIA_IMAGE_MAX_BYTES,
      files: AVARIA_IMAGE_MAX_COUNT
    }
  });
}

export function wrapMulter(middleware) {
  return (req, res, next) => middleware(req, res, (error) => {
    if (!error) return next();
    const normalized = normalizeMulterError(error);
    return res.status(400).json({ message: normalized.message, code: normalized.code, field: normalized.field || null });
  });
}

export function normalizeMulterError(error) {
  if (!error) return { message: 'Falha no upload.', code: 'UPLOAD_ERROR' };
  if (!(error instanceof multer.MulterError)) {
    return { message: error?.message || 'Falha no upload.', code: 'UPLOAD_ERROR' };
  }
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
      return { message: `Cada imagem de avaria pode ter no máximo ${Math.round(AVARIA_IMAGE_MAX_BYTES / (1024 * 1024))} MB.`, code: error.code, field: error.field };
    case 'LIMIT_FILE_COUNT':
      return { message: `É permitido enviar no máximo ${AVARIA_IMAGE_MAX_COUNT} imagens de avaria por operação.`, code: error.code, field: error.field };
    case 'LIMIT_UNEXPECTED_FILE':
      return { message: 'Formato de imagem inválido. Envie JPG, PNG, WEBP ou HEIC.', code: error.code, field: error.field };
    default:
      return { message: error.message || 'Falha no upload.', code: error.code, field: error.field };
  }
}

export function getUploadDirectoriesHealth() {
  const directories = [
    { label: 'documentos', path: ensureUploadDir('documentos') },
    { label: 'avarias', path: ensureUploadDir('avarias') }
  ];
  return directories.map((entry) => {
    const probeFile = path.join(entry.path, '.healthcheck');
    fs.writeFileSync(probeFile, String(Date.now()), 'utf8');
    const stats = fs.statSync(probeFile);
    fs.unlinkSync(probeFile);
    return {
      label: entry.label,
      path: entry.path,
      exists: fs.existsSync(entry.path),
      writable: true,
      readable: true,
      probeBytes: Number(stats.size || 0)
    };
  });
}
