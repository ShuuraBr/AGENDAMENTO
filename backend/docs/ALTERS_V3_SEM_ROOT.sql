ALTER TABLE `Agendamento`
  ADD COLUMN `checkoutToken` VARCHAR(191) NULL,
  ADD COLUMN `cpfMotorista` VARCHAR(191) NULL,
  ADD COLUMN `pesoTotalKg` DOUBLE NOT NULL DEFAULT 0,
  ADD COLUMN `valorTotalNf` DOUBLE NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX `Agendamento_checkoutToken_key` ON `Agendamento`(`checkoutToken`);
