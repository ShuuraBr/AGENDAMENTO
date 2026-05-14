-- V12 - Senha provisória para novos usuários
-- Execute este script no banco de dados antes de subir a versão nova.
--
-- Adiciona a flag senhaProvisoria na tabela Usuario.
-- Quando true, o usuário é obrigado a trocar a senha (padrão Obj@2026) no primeiro login.

ALTER TABLE `Usuario`
  ADD COLUMN `senhaProvisoria` TINYINT(1) NOT NULL DEFAULT 0 AFTER `perfil`;
