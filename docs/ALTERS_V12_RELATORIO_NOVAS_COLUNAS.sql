ALTER TABLE `RelatorioTerceirizado`
  ADD COLUMN `rowHash` VARCHAR(64) NULL,
  ADD COLUMN `agendamentoId` INT NULL,
  ADD COLUMN `PIS retido` TEXT NULL,
  ADD COLUMN `COFINS retida` TEXT NULL,
  ADD COLUMN `INSS retido` TEXT NULL,
  ADD COLUMN `IRRF retido` TEXT NULL,
  ADD COLUMN `CSLL retido` TEXT NULL,
  ADD COLUMN `ISSQN retido2` TEXT NULL,
  ADD COLUMN `Número do CT-e` TEXT NULL,
  ADD COLUMN `Transportadora` TEXT NULL,
  ADD COLUMN `Data de emissão do CT-e` TEXT NULL,
  ADD COLUMN `Valor do CT-e` TEXT NULL,
  ADD COLUMN `Data de entrada do CT-e` TEXT NULL,
  ADD COLUMN `Identificação NF-e` TEXT NULL,
  ADD COLUMN `Identificação CT-e/NF-e principal` TEXT NULL,
  ADD COLUMN `Identificação CT-e/NF-e auxiliar` TEXT NULL,
  ADD COLUMN `Fornecedor substituto tributário` TEXT NULL,
  ADD COLUMN `Destino` TEXT NULL,
  ADD COLUMN `origemArquivo` VARCHAR(255) NULL,
  ADD COLUMN `dadosOriginaisJson` LONGTEXT NULL,
  ADD COLUMN `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `RelatorioTerceirizado`
  ADD UNIQUE KEY `uk_relatorio_rowhash` (`rowHash`),
  ADD KEY `idx_relatorio_agendamento` (`agendamentoId`),
  ADD KEY `idx_relatorio_fornecedor` (`Fornecedor`(191)),
  ADD KEY `idx_relatorio_nf` (`Nr. nota`(191)),
  ADD KEY `idx_relatorio_status` (`Status`(191));
