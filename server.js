import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envCandidates = [
  path.join(__dirname, ".env"),
  path.join(__dirname, "backend", ".env")
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

import("./backend/src/server.js")
  .then(() => {
    console.log("[OK] Backend iniciado via server.js raiz");
  })
  .catch((err) => {
    console.error("[FATAL] Erro ao iniciar backend:", err);
    process.exit(1);
  });
