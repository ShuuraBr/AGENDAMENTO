import jwt from 'jsonwebtoken';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET não está definido. Configure a variável de ambiente JWT_SECRET antes de iniciar o servidor."
    );
  }
  return secret;
}

export const signToken = (payload) => jwt.sign(payload, getJwtSecret(), { expiresIn: '8h' });
export const verifyToken = (token) => jwt.verify(token, getJwtSecret());
