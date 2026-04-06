import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";
import { errorHandler } from "./middlewares/errorHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configurações Globais
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Definir caminhos absolutos robustos
const rootPath = path.resolve(__dirname, "..");
const publicPath = path.join(rootPath, "public");
const uploadsPath = path.join(rootPath, "uploads");

// Servir arquivos estáticos do Frontend (Pasta Public)
app.use(express.static(publicPath));

// Servir arquivos de Upload (Documentos/Fotos)
app.use("/uploads", express.static(uploadsPath));

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
