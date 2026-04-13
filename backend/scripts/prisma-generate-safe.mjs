import { existsSync } from "fs";
import process from "process";
import { spawnSync } from "child_process";

const truthy = new Set(["1", "true", "yes", "on"]);
const disabled = truthy.has(String(process.env.PRISMA_DISABLED || "").trim().toLowerCase());
const schemaArg = process.argv[2] || "prisma/schema.prisma";

if (disabled) {
  console.log("[PRISMA] Geração ignorada porque PRISMA_DISABLED=1.");
  process.exit(0);
}

if (!existsSync(schemaArg)) {
  console.log(`[PRISMA] Schema não encontrado em ${schemaArg}. Geração ignorada.`);
  process.exit(0);
}

const result = spawnSync(process.execPath, ["./node_modules/prisma/build/index.js", "generate", `--schema=${schemaArg}`], {
  stdio: "inherit",
  env: process.env
});

if (result.status !== 0) {
  console.warn("[PRISMA] prisma generate falhou. O projeto continuará operando em modo fallback.");
  process.exit(0);
}
