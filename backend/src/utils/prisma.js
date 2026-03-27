import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg;

let prismaClient = null;
let prismaInitError = null;

function createDeferredMethod(path) {
  return async (...args) => {
    const client = getPrismaClient();
    if (!client) {
      const error = prismaInitError || new Error("Prisma client indisponível.");
      error.statusCode = 503;
      throw error;
    }

    let target = client;
    for (const segment of path) {
      target = target?.[segment];
    }

    if (typeof target !== "function") {
      const error = new Error(`Método Prisma inválido: ${path.join(".")}`);
      error.statusCode = 500;
      throw error;
    }

    return target.apply(path.length > 1 ? client[path[0]] : client, args);
  };
}

function createModelProxy(path = []) {
  return new Proxy(() => {}, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === Symbol.toStringTag) return "PrismaProxy";
      return createModelProxy([...path, prop]);
    },
    apply() {
      return createDeferredMethod(path)();
    }
  });
}

function getPrismaClient() {
  if (prismaClient) return prismaClient;
  if (prismaInitError) return null;

  try {
    prismaClient = new PrismaClient();
    if (process.env.NODE_ENV !== "production") {
      globalThis.__agendamentoPrisma = prismaClient;
    }
    return prismaClient;
  } catch (error) {
    prismaInitError = error;
    console.error("Falha ao inicializar PrismaClient:", error?.message || error);
    return null;
  }
}

if (process.env.NODE_ENV !== "production" && globalThis.__agendamentoPrisma) {
  prismaClient = globalThis.__agendamentoPrisma;
}

export const prisma = createModelProxy();
export const getPrismaInitializationError = () => prismaInitError;
export const isPrismaReady = () => Boolean(getPrismaClient());

export const getPrismaClient = () => getPrismaClient();
