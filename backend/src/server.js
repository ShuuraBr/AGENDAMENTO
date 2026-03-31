import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Carregar variáveis de ambiente IMEDIATAMENTE
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

// 2. Configurar DATABASE_URL se não estiver presente (necessário para Prisma na Hostinger)
if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

// 3. Importar o app SOMENTE APÓS as variáveis estarem no process.env
import { default as app } from "./app.js";

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on('error', (err) => {
  console.error("[ERRO] Falha ao iniciar:", err);
  process.exit(1);
});
