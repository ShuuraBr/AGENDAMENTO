import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { env } from '../../config/env.js';

const storage = multer.diskStorage({
  destination: path.resolve(env.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

export const uploadDocumento = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
});
