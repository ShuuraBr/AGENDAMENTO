import { Router } from 'express';

export const agendamentosRouter = Router();

agendamentosRouter.get('/', (_req, res) => {
  res.json({
    items: [],
    total: 0,
    message: 'Lista inicial de agendamentos'
  });
});

agendamentosRouter.post('/', (req, res) => {
  return res.status(201).json({
    message: 'Agendamento criado com sucesso (stub)',
    data: req.body
  });
});
