-- Índices para corrigir lentidão e full table scans
-- Rodar uma única vez no banco de produção
-- Cada ALTER TABLE pode demorar alguns segundos dependendo do volume de dados

-- Índice principal: filtro por data (usado em quase toda query do sistema)
ALTER TABLE Agendamento ADD INDEX IF NOT EXISTS idx_agendamento_data_agendada (dataAgendada);

-- Índice para filtro por status (groupBy, KPIs, listagens)
ALTER TABLE Agendamento ADD INDEX IF NOT EXISTS idx_agendamento_status (status);

-- Índice composto: status + data (cobre groupBy filtrado por data e listagens combinadas)
ALTER TABLE Agendamento ADD INDEX IF NOT EXISTS idx_agendamento_status_data (status, dataAgendada);

-- Índice para LogAuditoria (usado em batchNotificationSummary e autorizações)
ALTER TABLE LogAuditoria ADD INDEX IF NOT EXISTS idx_log_entidade_id (entidade, entidadeId);
ALTER TABLE LogAuditoria ADD INDEX IF NOT EXISTS idx_log_acao (acao);

-- Verificar índices criados
SHOW INDEX FROM Agendamento WHERE Key_name LIKE 'idx_%';
SHOW INDEX FROM LogAuditoria WHERE Key_name LIKE 'idx_%';
