import { z } from 'zod';
export const createAgendamentoSchema = z.object({
  unidadeId:z.coerce.bigint(), docaId:z.coerce.bigint().optional().nullable(), fornecedorId:z.coerce.bigint().optional().nullable(), transportadoraId:z.coerce.bigint().optional().nullable(), motoristaId:z.coerce.bigint().optional().nullable(), veiculoId:z.coerce.bigint().optional().nullable(), origemSolicitacao:z.string().default('TRANSPORTADORA'),
  dataAgendada:z.string().date(), horaAgendada:z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/),
  quantidadeNotas:z.coerce.number().int().min(0).default(0), quantidadeVolumes:z.coerce.number().int().min(0).default(0), pesoTotalKg:z.coerce.number().optional().nullable(), valorTotalNf:z.coerce.number().optional().nullable(), observacoes:z.string().optional().nullable(),
});
export const listAgendamentosSchema = z.object({ data:z.string().optional(), status:z.string().optional() });