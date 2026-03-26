import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes.js';
import { agendamentosRouter } from '../modules/agendamentos/agendamentos.routes.js';
import { dashboardsRouter } from '../modules/dashboards/dashboards.routes.js';

export const router = Router();

router.use('/auth', authRouter);
router.use('/agendamentos', agendamentosRouter);
router.use('/dashboard', dashboardsRouter);
