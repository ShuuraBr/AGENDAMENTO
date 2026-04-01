import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import prismaPkg from "@prisma/client";
import { fileURLToPath } from "url";

const { PrismaClient } = prismaPkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");
const envPath = path.join(backendRoot, ".env");

dotenv.config({ override: true });
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}

const requiredDbVars = ["DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASS"];
const hasDbParts = requiredDbVars.every((key) => {
  const value = process.env[key];
  return typeof value === "string" && value.trim() !== "";
});

if (hasDbParts) {
  process.env.DATABASE_URL =
    `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
}

let prismaClient = null;

export function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      log: ["error", "warn"]
    });
  }
  return prismaClient;
}

export const prisma = new Proxy(
  {},
  {
    get(_target, prop) {
      return getPrismaClient()[prop];
    }
  }
);
