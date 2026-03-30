import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");

const app = express();
const publicDir = path.join(backendRoot, "public");
const uploadsDir = path.join(backendRoot, "uploads");
const indexFile = path.join(publicDir, "index.html");

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

app.disable("x-powered-by");
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/uploads", express.static(uploadsDir));
app.use("/api", routes);
app.use(express.static(publicDir));

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  if (!fs.existsSync(indexFile)) {
    return res.status(200).type("text/plain").send("API online");
  }
  return res.sendFile(indexFile);
});

export default app;
