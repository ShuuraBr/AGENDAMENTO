import dotenv from 'dotenv';
dotenv.config();

for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
  if (!process.env[key]) throw new Error(`Variável obrigatória não definida: ${key}`);
}

export const env = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN || '*',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  uploadDir: process.env.UPLOAD_DIR || './uploads',
};
