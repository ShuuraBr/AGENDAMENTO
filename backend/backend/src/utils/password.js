import bcrypt from 'bcryptjs'; export const hashPassword=(p)=>bcrypt.hash(p,10); export const comparePassword=(p,h)=>bcrypt.compare(p,h);
