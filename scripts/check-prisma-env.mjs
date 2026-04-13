import os from "os";
import process from "process";

const env = process.env;
const lines = [];
lines.push(`platform=${process.platform}`);
lines.push(`arch=${process.arch}`);
lines.push(`hostname=${os.hostname()}`);
lines.push(`node=${process.version}`);
lines.push(`DATABASE_URL=${env.DATABASE_URL ? "configurada" : "ausente"}`);
lines.push(`DB_HOST=${env.DB_HOST || "ausente"}`);
lines.push(`DB_PORT=${env.DB_PORT || "ausente"}`);
lines.push(`DB_NAME=${env.DB_NAME || "ausente"}`);
lines.push(`DB_USER=${env.DB_USER || "ausente"}`);
lines.push(`PRISMA_DISABLED=${env.PRISMA_DISABLED || "0"}`);
console.log(lines.join("
"));
