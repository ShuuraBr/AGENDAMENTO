import express from "express";
import { default as app } from "./app.js";

const PORT = Number(process.env.PORT || 3000);

console.log("[boot] backend server iniciando");

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
