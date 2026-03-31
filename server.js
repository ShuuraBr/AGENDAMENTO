import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

console.log("[boot] iniciando server.js raiz");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootEnvPath = path.join(__dirname, ".env");
const backendEnvPath = path.join(__dirname, "backend", ".env");

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath, override: true });
  console.log("[boot] .env da raiz carregado");
} else {
  console.log("[boot] .env da raiz não encontrado");
}

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: true });
  console.log("[boot] .env do backend carregado");
} else {
  console.log("[boot] .env do backend não encontrado");
}

console.log("[boot] NODE_ENV =", process.env.NODE_ENV);
console.log("[boot] PORT =", process.env.PORT);
console.log("[boot] DB_HOST =", process.env.DB_HOST);
console.log("[boot] DB_PORT =", process.env.DB_PORT);
console.log("[boot] DB_NAME =", process.env.DB_NAME);
console.log("[boot] DB_USER =", process.env.DB_USER);
console.log("[boot] DATABASE_URL existe antes =", !!process.env.DATABASE_URL);

const requiredDbVars = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
const hasDbParts = requiredDbVars.every((key) => {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "";
});

if (!process.env.DATABASE_URL && hasDbParts) {
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}` +
    `@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

  console.log("[boot] DATABASE_URL montada a partir de DB_*");
}

console.log("[boot] DATABASE_URL existe depois =", !!process.env.DATABASE_URL);
console.log("[boot] carregando backend/src/server.js ...");

await import("./backend/src/server.js");