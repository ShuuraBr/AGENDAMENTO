import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { router } from './routes/index.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());
app.use(morgan('dev'));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'agendamento-descarga-api',
    environment: env.nodeEnv
  });
});

app.use('/api', router);
