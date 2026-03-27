import app from "./app.js";

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, "0.0.0.0", () => {
  console.log("=================================");
  console.log(`API/Frontend rodando em http://localhost:${PORT}`);
  console.log("=================================");
});
