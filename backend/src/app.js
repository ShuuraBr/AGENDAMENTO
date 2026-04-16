import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { authRequired } from "./middlewares/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configurações Globais
const allowedOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("Origem não permitida pelo CORS."));
  },
  credentials: true
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Definir caminhos absolutos robustos
const rootPath = path.resolve(__dirname, "..");
const publicPath = path.join(rootPath, "public");
const uploadsPath = path.join(rootPath, "uploads");

// Servir arquivos estáticos do Frontend (Pasta Public)
app.use(express.static(publicPath));

// Servir arquivos de Upload (Documentos/Fotos) — requer autenticação
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
      res.status(500).send("O servidor não conseguiu encontrar os arquivos do frontend. Verifique a pasta 'public'.");
    }
  });
});

// Middleware de Tratamento de Erros
app.use(errorHandler);

export default app;
