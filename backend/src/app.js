import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { env } from "./config/env.js";
import { authRequired } from "./middlewares/auth.js";

let helmet;
try {
  helmet = (await import("helmet")).default;
} catch {
  console.warn("[SECURITY WARNING] helmet not installed. Run: npm install helmet");
}

let rateLimit;
try {
  const mod = await import("express-rate-limit");
  rateLimit = mod.rateLimit || mod.default;
} catch {
  console.warn("[SECURITY WARNING] express-rate-limit not installed. Run: npm install express-rate-limit");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ─── Security Headers (helmet) ───
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
}

// ─── CORS – whitelist-based ───
const allowedOrigins = String(env.corsOrigins || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    credentials: true,
  })
);

// ─── Body parsing with explicit size limits ───
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── General rate limiting ───
if (rateLimit) {
  app.use(
    "/api",
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: Number(process.env.RATE_LIMIT_MAX || 300),
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: "Muitas requisições. Tente novamente mais tarde." },
    })
  );
}

// Definir caminhos absolutos robustos
const rootPath = path.resolve(__dirname, "..");
const publicPath = path.join(rootPath, "public");
const uploadsPath = path.join(rootPath, "uploads");

// Servir arquivos estáticos do Frontend (Pasta Public)
app.use(express.static(publicPath));

// Servir arquivos de Upload – require authentication
app.use("/uploads", authRequired, express.static(uploadsPath));

// Registrar todas as Rotas da API
app.use("/api", routes);

// Rota para o Frontend (Single Page Application)
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Rota de API não encontrada" });
  }

  const indexPath = path.join(publicPath, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error("[ERRO] Falha ao servir index.html:", err.message);
      res.status(500).send("Erro ao carregar a aplicação.");
    }
  });
});

// Middleware de Tratamento de Erros
app.use(errorHandler);

export default app;
