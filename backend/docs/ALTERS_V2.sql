ALTER TABLE Agendamento ADD COLUMN motoristaCpf VARCHAR(14) NULL AFTER telefoneMotorista;
ALTER TABLE Agendamento ADD COLUMN pesoTotal DOUBLE NOT NULL DEFAULT 0 AFTER quantidadeVolumes;
ALTER TABLE Agendamento ADD COLUMN valorTotal DOUBLE NOT NULL DEFAULT 0 AFTER pesoTotal;

-- Depois execute: npx prisma generate
