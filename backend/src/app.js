import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import routes from "./routes/index.js";
import { env } from "./config/env.js";

const app = express();
fs.mkdirSync(path.resolve("uploads"), { recursive: true });

app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());
app.use("/uploads", express.static(path.resolve("uploads")));
app.use("/api", routes);

export default app;
