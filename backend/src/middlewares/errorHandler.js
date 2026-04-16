export function errorHandler(err, req, res, next) {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  const message = status < 500
    ? (err.message || 'Erro na requisição')
    : 'Erro interno do servidor';
  return res.status(status).json({ message });
}
