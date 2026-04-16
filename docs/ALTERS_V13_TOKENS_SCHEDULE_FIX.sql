-- =============================================================
-- ALTERS_V13 – Garante que todas as colunas de token, contato
-- e agendamento existam na tabela de agendamentos.
-- Execute ANTES de reiniciar o backend com o código corrigido.
-- Cada ALTER usa IF NOT EXISTS (ou IGNORE) para ser idempotente.
-- =============================================================

-- Tabela pode se chamar "Agendamento" (Prisma) ou "agendamentos" (schema novo).
-- Ajuste o nome abaixo conforme o seu ambiente.
-- Se estiver usando o schema novo (agendamentos em snake_case), troque
-- "Agendamento" por "agendamentos" em todos os comandos.

-- 1) Colunas de janela
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS janela_id BIGINT UNSIGNED NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS janelaId BIGINT UNSIGNED NULL;

-- 2) Nomes textuais desnormalizados
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS fornecedor VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS transportadora VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS motorista VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS placa VARCHAR(20) NULL;

-- 3) Contato do motorista e transportadora
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS cpf_motorista VARCHAR(20) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS cpfMotorista VARCHAR(20) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS telefone_motorista VARCHAR(20) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS telefoneMotorista VARCHAR(20) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS email_motorista VARCHAR(150) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS emailMotorista VARCHAR(150) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS email_transportadora VARCHAR(150) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS emailTransportadora VARCHAR(150) NULL;

-- 4) Tokens públicos
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS public_token_motorista VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS publicTokenMotorista VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS public_token_fornecedor VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS publicTokenFornecedor VARCHAR(191) NULL;

-- 5) Tokens de check-in / check-out
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkin_token VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkinToken VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkout_token VARCHAR(191) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkoutToken VARCHAR(191) NULL;

-- 6) Campos operacionais extras
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkin_em DATETIME NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS checkinEm DATETIME NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS observacoes_internas TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS observacoesInternas TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS motivo_reprovacao TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS motivoReprovacao TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS motivoCancelamento TEXT NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS cancelado_por_usuario_id BIGINT UNSIGNED NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS canceladoPorUsuarioId BIGINT UNSIGNED NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS cancelado_em DATETIME NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS canceladoEm DATETIME NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS lgpd_consent_at DATETIME NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS lgpdConsentAt DATETIME NULL;

-- 7) Peso e valor (podem já existir via ALTERS_V3)
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS peso_total_kg DECIMAL(12,3) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS pesoTotalKg DECIMAL(12,3) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS valor_total_nf DECIMAL(14,2) NULL;
ALTER TABLE Agendamento ADD COLUMN IF NOT EXISTS valorTotalNf DECIMAL(14,2) NULL;

-- 8) Adiciona REPROVADO ao enum de status (caso não esteja)
-- MySQL exige redefinir o ENUM. Descomente e ajuste se necessário:
-- ALTER TABLE Agendamento MODIFY COLUMN status ENUM('SOLICITADO','PENDENTE_APROVACAO','APROVADO','REPROVADO','CANCELADO','CHEGOU','EM_DESCARGA','FINALIZADO','NO_SHOW') NOT NULL DEFAULT 'SOLICITADO';
