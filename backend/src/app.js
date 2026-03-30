import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import routes from "./routes/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const backendEnvPath = path.join(backendRoot, ".env");

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

const app = express();
const publicDir = path.join(backendRoot, "public");
const uploadsDir = path.join(backendRoot, "uploads");
const indexFile = path.join(publicDir, "index.html");

fs.mkdirSync(publicDir, { recursive: true });
fs.mkdirSync(uploadsDir, { recursive: true });

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  );
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
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
