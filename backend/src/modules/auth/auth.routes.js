import { Router } from 'express';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const { email } = req.body;

  return res.json({
    message: 'Login placeholder',
    user: {
      email: email || 'admin@empresa.com',
      role: 'ADMIN'
    },
    token: 'dev-token'
  });
});
