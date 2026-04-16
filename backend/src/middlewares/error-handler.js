export function errorHandler(err, req, res, next) {
  console.error(err);
  if (err?.name === 'ZodError') {
    return res.status(400).json({
      message: 'Dados inválidos.',
      errors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    });
  }
  const status = err.status || err.statusCode || 500;
  const message = status < 500
    ? (err.message || 'Erro na requisição.')
    : 'Erro interno do servidor.';
  return res.status(status).json({ message });
}
