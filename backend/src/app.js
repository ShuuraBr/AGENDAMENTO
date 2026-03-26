import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import routes from "./routes/index.js";

const app = express();

fs.mkdirSync(path.resolve("uploads"), { recursive: true });

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(path.resolve("uploads")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, message: "API online" });
});

app.get("/", (_req, res) => {
  res.send("API rodando");
});

app.use("/api", routes);

export default app;
