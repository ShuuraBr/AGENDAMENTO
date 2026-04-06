-- V4 - Auditoria operacional e pesquisa de atendimento pós check-out
-- Execute este script no banco antes de subir a versão nova, caso a tabela ainda não exista.

CREATE TABLE IF NOT EXISTS `AvaliacaoAtendimento` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `agendamentoId` INT NOT NULL,
  `token` VARCHAR(191) NOT NULL,
  `protocolo` VARCHAR(191) NULL,
  `emailMotorista` VARCHAR(191) NULL,
  `notaAtendimento` INT NULL,
  `notaEquipeRecebimento` INT NULL,
  `processoTranquilo` TINYINT(1) NULL,
  `processoRapido` TINYINT(1) NULL,
  `comentario` LONGTEXT NULL,
  `enviadoEm` DATETIME(3) NULL,
  `respondidoEm` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `AvaliacaoAtendimento_agendamentoId_key` (`agendamentoId`),
  UNIQUE KEY `AvaliacaoAtendimento_token_key` (`token`),
  KEY `AvaliacaoAtendimento_respondidoEm_idx` (`respondidoEm`),
  CONSTRAINT `AvaliacaoAtendimento_agendamentoId_fkey`
    FOREIGN KEY (`agendamentoId`) REFERENCES `Agendamento` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
