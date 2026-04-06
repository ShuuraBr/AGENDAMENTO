export function normalizeDatabaseError(error) {
  const message = error?.message || String(error || "Erro de banco de dados.");

  if (/Authentication failed against database server/i.test(message)) {
    const normalized = new Error(
      "Falha de autenticação no banco de dados. Revise DB_HOST, DB_PORT, DB_NAME, DB_USER e DB_PASS no arquivo .env. Se a senha possuir caracteres especiais, deixe DATABASE_URL vazio e use somente os campos DB_*."
    );
    normalized.statusCode = 503;
    normalized.originalMessage = message;
    return normalized;
  }

  if (/Can't reach database server/i.test(message) || /connect ECONNREFUSED/i.test(message) || /connect ETIMEDOUT/i.test(message)) {
    const normalized = new Error(
      "Não foi possível conectar ao banco de dados. Verifique host, porta, firewall e liberação de acesso remoto do MySQL."
    );
    normalized.statusCode = 503;
    normalized.originalMessage = message;
    return normalized;
  }

  return error instanceof Error ? error : new Error(message);
}
