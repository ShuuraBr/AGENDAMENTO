import { z } from 'zod';
export const createSchema = z.object({ unidadeId:z.coerce.bigint(), codigo:z.string().min(1), descricao:z.string().optional().nullable(), capacidadeVeiculosSimultaneos:z.coerce.number().int().min(1).default(1), tempoPadraoDescargaMin:z.coerce.number().int().min(1).default(60), ativa:z.boolean().default(true) });
export const updateSchema = createSchema.partial();