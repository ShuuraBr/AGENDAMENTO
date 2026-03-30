import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

console.log("[boot] iniciando server.js raiz");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendEnvPath = path.join(__dirname, "backend", ".env");

dotenv.config({ override: true });

if (fs.existsSync(backendEnvPath)) {
  dotenv.config({ path: backendEnvPath, override: true });
}

const requiredDbVars = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
const hasDbParts = requiredDbVars.every((key) => {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "";
});

if (hasDbParts) {
  process.env.DATABASE_URL = `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

await import("./backend/src/server.js");
