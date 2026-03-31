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

// Servir arquivos estáticos do Frontend (Pasta Public)
// Na Hostinger, o caminho relativo pode variar dependendo de onde o processo inicia
const publicPath = path.resolve(__dirname, "../public");
app.use(express.static(publicPath));

// Servir arquivos de Upload (Documentos/Fotos)
const uploadsPath = path.resolve(__dirname, "../uploads");
app.use("/uploads", express.static(uploadsPath));

// Registrar todas as Rotas da API
app.use("/api", routes);

// Rota para o Frontend (Single Page Application)
// Garante que qualquer rota não encontrada na API carregue o index.html
app.get("*", (req, res) => {
  // Evita que chamadas de API inexistentes retornem o HTML do frontend
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Rota de API não encontrada" });
  }
  res.sendFile(path.join(publicPath, "index.html"), (err) => {
    if (err) {
      res.status(404).send("Frontend não encontrado. Verifique a pasta public.");
    }
  });
});

// Middleware de Tratamento de Erros
app.use(errorHandler);

export default app;
