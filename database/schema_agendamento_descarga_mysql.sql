CREATE DATABASE IF NOT EXISTS agendamento_descarga CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE agendamento_descarga;

CREATE TABLE IF NOT EXISTS perfis (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(50) NOT NULL UNIQUE,
    descricao VARCHAR(255) NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    telefone VARCHAR(20) NULL,
    senha_hash VARCHAR(255) NOT NULL,
    perfil_id BIGINT UNSIGNED NOT NULL,
    status ENUM('ATIVO','INATIVO','BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    ultimo_login_em DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_usuarios_perfil FOREIGN KEY (perfil_id) REFERENCES perfis(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS unidades (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30) NOT NULL UNIQUE,
    nome VARCHAR(120) NOT NULL,
    cidade VARCHAR(120) NULL,
    uf CHAR(2) NULL,
    ativa TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS docas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    unidade_id BIGINT UNSIGNED NOT NULL,
    codigo VARCHAR(30) NOT NULL,
    descricao VARCHAR(255) NULL,
    capacidade_veiculos_simultaneos INT NOT NULL DEFAULT 1,
    tempo_padrao_descarga_min INT NOT NULL DEFAULT 60,
    ativa TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_docas_unidade_codigo (unidade_id, codigo),
    CONSTRAINT fk_docas_unidade FOREIGN KEY (unidade_id) REFERENCES unidades(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS fornecedores (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    razao_social VARCHAR(180) NOT NULL,
    nome_fantasia VARCHAR(180) NULL,
    cnpj VARCHAR(18) NULL UNIQUE,
    email VARCHAR(150) NULL,
    telefone VARCHAR(20) NULL,
    whatsapp VARCHAR(20) NULL,
    contato_responsavel VARCHAR(120) NULL,
    status ENUM('ATIVO','INATIVO','BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    observacoes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transportadoras (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    razao_social VARCHAR(180) NOT NULL,
    nome_fantasia VARCHAR(180) NULL,
    cnpj VARCHAR(18) NULL UNIQUE,
    email VARCHAR(150) NULL,
    telefone VARCHAR(20) NULL,
    whatsapp VARCHAR(20) NULL,
    contato_responsavel VARCHAR(120) NULL,
    status ENUM('ATIVO','INATIVO','BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    observacoes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS motoristas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transportadora_id BIGINT UNSIGNED NULL,
    nome VARCHAR(150) NOT NULL,
    cpf VARCHAR(14) NULL,
    telefone VARCHAR(20) NULL,
    whatsapp VARCHAR(20) NULL,
    email VARCHAR(150) NULL,
    status ENUM('ATIVO','INATIVO','BLOQUEADO') NOT NULL DEFAULT 'ATIVO',
    observacoes TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_motoristas_transportadora FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS veiculos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    transportadora_id BIGINT UNSIGNED NULL,
    placa_cavalo VARCHAR(10) NULL,
    placa_carreta VARCHAR(10) NULL,
    tipo_veiculo VARCHAR(60) NOT NULL,
    capacidade_peso_kg DECIMAL(12,3) NULL,
    capacidade_volume_m3 DECIMAL(12,3) NULL,
    observacoes TEXT NULL,
    ativo TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_veiculos_transportadora FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agendamentos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    protocolo VARCHAR(40) NOT NULL UNIQUE,
    unidade_id BIGINT UNSIGNED NOT NULL,
    doca_id BIGINT UNSIGNED NULL,
    fornecedor_id BIGINT UNSIGNED NULL,
    transportadora_id BIGINT UNSIGNED NULL,
    motorista_id BIGINT UNSIGNED NULL,
    veiculo_id BIGINT UNSIGNED NULL,
    origem_solicitacao ENUM('MOTORISTA','TRANSPORTADORA','FORNECEDOR','INTERNO','API') NOT NULL DEFAULT 'TRANSPORTADORA',
    status ENUM('SOLICITADO','PENDENTE_APROVACAO','APROVADO','CANCELADO','CHEGOU','EM_DESCARGA','FINALIZADO','NO_SHOW') NOT NULL DEFAULT 'SOLICITADO',
    data_agendada DATE NOT NULL,
    hora_agendada TIME NOT NULL,
    previsao_chegada DATETIME NULL,
    chegada_real_em DATETIME NULL,
    inicio_descarga_em DATETIME NULL,
    fim_descarga_em DATETIME NULL,
    quantidade_notas INT NOT NULL DEFAULT 0,
    quantidade_volumes INT NOT NULL DEFAULT 0,
    peso_total_kg DECIMAL(12,3) NULL,
    valor_total_nf DECIMAL(14,2) NULL,
    observacoes TEXT NULL,
    no_show TINYINT(1) NOT NULL DEFAULT 0,
    atraso_minutos INT NOT NULL DEFAULT 0,
    conformidade_status ENUM('PENDENTE','CONFORME','NAO_CONFORME','PARCIAL') NOT NULL DEFAULT 'PENDENTE',
    criado_por_usuario_id BIGINT UNSIGNED NULL,
    aprovado_por_usuario_id BIGINT UNSIGNED NULL,
    aprovado_em DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_agendamentos_unidade FOREIGN KEY (unidade_id) REFERENCES unidades(id),
    CONSTRAINT fk_agendamentos_doca FOREIGN KEY (doca_id) REFERENCES docas(id),
    CONSTRAINT fk_agendamentos_fornecedor FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id),
    CONSTRAINT fk_agendamentos_transportadora FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id),
    CONSTRAINT fk_agendamentos_motorista FOREIGN KEY (motorista_id) REFERENCES motoristas(id),
    CONSTRAINT fk_agendamentos_veiculo FOREIGN KEY (veiculo_id) REFERENCES veiculos(id),
    CONSTRAINT fk_agendamentos_criado_por FOREIGN KEY (criado_por_usuario_id) REFERENCES usuarios(id),
    CONSTRAINT fk_agendamentos_aprovado_por FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO perfis (nome, descricao) VALUES
('ADMIN', 'Administrador do sistema'),
('GESTOR_LOGISTICO', 'Gestão logística'),
('OPERADOR_RECEBIMENTO', 'Operação de recebimento');

CREATE OR REPLACE VIEW vw_agendamentos_dashboard AS
SELECT
    a.id, a.protocolo, a.status, a.data_agendada, a.hora_agendada,
    a.quantidade_notas, a.quantidade_volumes, a.peso_total_kg, a.valor_total_nf,
    u.nome AS unidade, d.codigo AS doca, f.razao_social AS fornecedor,
    t.razao_social AS transportadora, m.nome AS motorista,
    v.placa_cavalo, v.placa_carreta, v.tipo_veiculo
FROM agendamentos a
LEFT JOIN unidades u ON u.id = a.unidade_id
LEFT JOIN docas d ON d.id = a.doca_id
LEFT JOIN fornecedores f ON f.id = a.fornecedor_id
LEFT JOIN transportadoras t ON t.id = a.transportadora_id
LEFT JOIN motoristas m ON m.id = a.motorista_id
LEFT JOIN veiculos v ON v.id = a.veiculo_id;
