-- V13 - Adiciona valores faltantes no ENUM de status do Agendamento
-- EXECUTE ESTE SCRIPT NO BANCO ANTES DE REINICIAR O SERVIDOR
--
-- Contexto: os valores REPROVADO, REAGENDADO (e possivelmente EM_DESCARGA) foram
-- adicionados ao código JS mas nunca ao ENUM do MySQL. Em modo não-estrito,
-- o MySQL guarda '' (vazio) para valores não reconhecidos — o que faz o status
-- parecer "reverter" para PENDENTE_APROVACAO após cada transição.

-- Tabela Prisma (camelCase) — principal
ALTER TABLE `Agendamento`
  MODIFY COLUMN `status` ENUM(
    'SOLICITADO',
    'PENDENTE_APROVACAO',
    'APROVADO',
    'REPROVADO',
    'CANCELADO',
    'CHEGOU',
    'EM_DESCARGA',
    'FINALIZADO',
    'NO_SHOW',
    'REAGENDADO'
  ) NOT NULL DEFAULT 'PENDENTE_APROVACAO';

-- Tabela snake_case (schema alternativo) — aplica se existir
ALTER TABLE IF EXISTS `agendamentos`
  MODIFY COLUMN `status` ENUM(
    'SOLICITADO',
    'PENDENTE_APROVACAO',
    'APROVADO',
    'REPROVADO',
    'CANCELADO',
    'CHEGOU',
    'EM_DESCARGA',
    'FINALIZADO',
    'NO_SHOW',
    'REAGENDADO'
  ) NOT NULL DEFAULT 'PENDENTE_APROVACAO';

-- Corrige registros com status vazio ('' armazenado antes do fix)
UPDATE `Agendamento` SET `status` = 'PENDENTE_APROVACAO' WHERE `status` = '' OR `status` IS NULL;
