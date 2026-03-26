import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';
import router from './routes/index.js';
import { env } from './config/env.js';
import { errorHandler } from './middlewares/error-handler.js';

const app = express();
const uploadsPath = path.resolve(env.uploadDir);
fs.mkdirSync(uploadsPath, { recursive: true });

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: env.corsOrigin === '*' ? true : env.corsOrigin.split(',') }));
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(uploadsPath));
app.use('/api', router);
app.use(errorHandler);

export default app;
