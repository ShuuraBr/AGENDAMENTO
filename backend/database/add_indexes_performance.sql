-- Índices para corrigir lentidão e full table scans
-- Rodar uma única vez no banco de produção
-- Cada ALTER TABLE pode demorar alguns segundos dependendo do volume de dados

-- Índice principal: filtro por data (usado em quase toda query do sistema)
ALTER TABLE agendamentos ADD INDEX IF NOT EXISTS idx_agendamentos_data_agendada (data_agendada);

-- Índice para filtro por status (groupBy, KPIs, listagens)
ALTER TABLE agendamentos ADD INDEX IF NOT EXISTS idx_agendamentos_status (status);

-- Índice composto: status + data (cobre groupBy filtrado por data e listagens combinadas)
ALTER TABLE agendamentos ADD INDEX IF NOT EXISTS idx_agendamentos_status_data (status, data_agendada);

-- Índice para log_auditoria (usado em batchNotificationSummary e autorizações)
ALTER TABLE log_auditoria ADD INDEX IF NOT EXISTS idx_log_entidade_id (entidade, entidade_id);
ALTER TABLE log_auditoria ADD INDEX IF NOT EXISTS idx_log_acao (acao);

-- Verificar índices criados
SHOW INDEX FROM agendamentos WHERE Key_name LIKE 'idx_%';
