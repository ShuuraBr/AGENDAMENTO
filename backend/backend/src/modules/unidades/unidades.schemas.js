import { z } from 'zod';
export const createSchema = z.object({ codigo:z.string().min(1), nome:z.string().min(2), cidade:z.string().optional().nullable(), uf:z.string().length(2).optional().nullable(), ativa:z.boolean().default(true) });
export const updateSchema = createSchema.partial();