ALTER TABLE Agendamento
  ADD COLUMN checkoutToken VARCHAR(191) NULL AFTER checkinToken,
  ADD COLUMN cpfMotorista VARCHAR(20) NULL AFTER motorista,
  ADD COLUMN pesoTotalKg DECIMAL(12,3) NULL AFTER quantidadeVolumes,
  ADD COLUMN valorTotalNf DECIMAL(14,2) NULL AFTER pesoTotalKg;
