import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const envCandidates = [
  path.join(projectRoot, ".env"),
  path.join(projectRoot, "backend", ".env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

if (!process.env.DATABASE_URL && process.env.DB_HOST) {
  const { DB_USER, DB_PASS, DB_HOST, DB_PORT, DB_NAME } = process.env;
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(DB_USER)}:${encodeURIComponent(DB_PASS)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

const { default: app } = await import("./app.js");

const PORT = Number(process.env.PORT || 3000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[OK] Servidor rodando na porta ${PORT}`);
});

server.on("error", (err) => {
  console.error("[ERRO] Falha ao iniciar:", err);
  process.exit(1);
});
