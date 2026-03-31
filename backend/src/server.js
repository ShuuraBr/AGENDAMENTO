import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { default as app } from "./app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carregar variáveis de ambiente do .env na pasta backend
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
  console.log("[boot] Arquivo .env carregado com sucesso.");
} else {
  console.warn("[boot] Aviso: Arquivo .env não encontrado em: " + envPath);
}

// Configuração automática da DATABASE_URL se não estiver presente
if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
  console.log("[boot] DATABASE_URL gerada dinamicamente.");
}

const PORT = Number(process.env.PORT || 3000);

console.log("[boot] backend server iniciando...");

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[boot] Servidor rodando na porta ${PORT}`);
  console.log(`[boot] Modo: ${process.env.NODE_ENV || 'development'}`);
});

// Tratamento de erros de inicialização do servidor
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[erro] Porta ${PORT} já está em uso.`);
  } else {
    console.error("[erro] Falha ao iniciar servidor:", err);
  }
  process.exit(1);
});
