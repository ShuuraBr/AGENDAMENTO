import express from "express";
import cors from "cors";
import routes from "./routes/index.js";
import { env } from "./config/env.js";

const app = express();
app.use(cors({ origin: env.frontendUrl }));
app.use(express.json());
app.use("/api", routes);
export default app;
