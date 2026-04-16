export function errorHandler(err, req, res, _next) {
  console.error('[ErrorHandler]', err);

  if (err?.name === 'ZodError') {
    return res.status(400).json({
      message: 'Dados inválidos.',
      errors: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
  }

  const status = err.status || err.statusCode || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  return res.status(status).json({
    message: status >= 500 && isProduction
      ? 'Erro interno do servidor.'
      : (err.message || 'Erro interno do servidor.'),
  });
}
