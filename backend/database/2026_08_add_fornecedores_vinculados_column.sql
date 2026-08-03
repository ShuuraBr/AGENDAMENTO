-- Adiciona a coluna que faltava para persistir o vínculo Transportadora -> Fornecedores
-- diretamente no banco (antes esse vínculo só existia em backend/data/transportadoras.json,
-- por isso não sobrevivia a um redeploy sem disco persistente / não aparecia em consultas
-- feitas direto no MySQL).
--
-- Rode este script uma única vez contra o banco de produção/homologação:
--   mysql -h <host> -u <user> -p <database> < backend/database/2026_08_add_fornecedores_vinculados_column.sql

ALTER TABLE `Transportadora`
  ADD COLUMN `fornecedoresVinculados` JSON NULL DEFAULT NULL;
