import { Router } from 'express';

export const dashboardsRouter = Router();

dashboardsRouter.get('/operacional', (_req, res) => {
  res.json({
    agendadosHoje: 0,
    emAndamento: 0,
    concluidos: 0,
    atrasados: 0,
    noShow: 0,
    pendentesAprovacao: 0
  });
});
