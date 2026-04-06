import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';

const uploadPath = path.resolve(process.cwd(), env.uploadDir);
fs.mkdirSync(uploadPath, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadPath),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`;
    cb(null, safeName);
  },
});

export const upload = multer({ storage });
