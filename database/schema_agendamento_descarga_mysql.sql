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
    janela_id BIGINT UNSIGNED NULL,
    fornecedor_id BIGINT UNSIGNED NULL,
    transportadora_id BIGINT UNSIGNED NULL,
    motorista_id BIGINT UNSIGNED NULL,
    veiculo_id BIGINT UNSIGNED NULL,
    fornecedor VARCHAR(191) NULL,
    transportadora VARCHAR(191) NULL,
    motorista VARCHAR(191) NULL,
    placa VARCHAR(20) NULL,
    cpf_motorista VARCHAR(20) NULL,
    telefone_motorista VARCHAR(20) NULL,
    email_motorista VARCHAR(150) NULL,
    email_transportadora VARCHAR(150) NULL,
    public_token_motorista VARCHAR(191) NULL,
    public_token_fornecedor VARCHAR(191) NULL,
    checkin_token VARCHAR(191) NULL,
    checkout_token VARCHAR(191) NULL,
    origem_solicitacao ENUM('MOTORISTA','TRANSPORTADORA','FORNECEDOR','INTERNO','API') NOT NULL DEFAULT 'TRANSPORTADORA',
    status ENUM('SOLICITADO','PENDENTE_APROVACAO','APROVADO','REPROVADO','CANCELADO','CHEGOU','EM_DESCARGA','FINALIZADO','NO_SHOW') NOT NULL DEFAULT 'SOLICITADO',
    data_agendada DATE NOT NULL,
    hora_agendada TIME NOT NULL,
    previsao_chegada DATETIME NULL,
    chegada_real_em DATETIME NULL,
    checkin_em DATETIME NULL,
    inicio_descarga_em DATETIME NULL,
    fim_descarga_em DATETIME NULL,
    quantidade_notas INT NOT NULL DEFAULT 0,
    quantidade_volumes INT NOT NULL DEFAULT 0,
    peso_total_kg DECIMAL(12,3) NULL,
    valor_total_nf DECIMAL(14,2) NULL,
    observacoes TEXT NULL,
    observacoes_internas TEXT NULL,
    motivo_reprovacao TEXT NULL,
    motivo_cancelamento TEXT NULL,
    no_show TINYINT(1) NOT NULL DEFAULT 0,
    atraso_minutos INT NOT NULL DEFAULT 0,
    conformidade_status ENUM('PENDENTE','CONFORME','NAO_CONFORME','PARCIAL') NOT NULL DEFAULT 'PENDENTE',
    criado_por_usuario_id BIGINT UNSIGNED NULL,
    aprovado_por_usuario_id BIGINT UNSIGNED NULL,
    aprovado_em DATETIME NULL,
    cancelado_por_usuario_id BIGINT UNSIGNED NULL,
    cancelado_em DATETIME NULL,
    lgpd_consent_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_agendamentos_checkin_token (checkin_token),
    UNIQUE KEY uk_agendamentos_checkout_token (checkout_token),
    CONSTRAINT fk_agendamentos_unidade FOREIGN KEY (unidade_id) REFERENCES unidades(id),
    CONSTRAINT fk_agendamentos_doca FOREIGN KEY (doca_id) REFERENCES docas(id),
    CONSTRAINT fk_agendamentos_fornecedor FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id),
    CONSTRAINT fk_agendamentos_transportadora FOREIGN KEY (transportadora_id) REFERENCES transportadoras(id),
    CONSTRAINT fk_agendamentos_motorista FOREIGN KEY (motorista_id) REFERENCES motoristas(id),
    CONSTRAINT fk_agendamentos_veiculo FOREIGN KEY (veiculo_id) REFERENCES veiculos(id),
    CONSTRAINT fk_agendamentos_criado_por FOREIGN KEY (criado_por_usuario_id) REFERENCES usuarios(id),
    CONSTRAINT fk_agendamentos_aprovado_por FOREIGN KEY (aprovado_por_usuario_id) REFERENCES usuarios(id),
    CONSTRAINT fk_agendamentos_cancelado_por FOREIGN KEY (cancelado_por_usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS janelas (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    doca_id BIGINT UNSIGNED NULL,
    codigo VARCHAR(60) NOT NULL,
    data_agendamento DATE NULL,
    hora_inicio TIME NULL,
    hora_fim TIME NULL,
    capacidade_total INT NOT NULL DEFAULT 1,
    ocupacao_atual INT NOT NULL DEFAULT 0,
    disponivel TINYINT(1) NOT NULL DEFAULT 1,
    ativa TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_janelas_doca FOREIGN KEY (doca_id) REFERENCES docas(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notas_fiscais (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agendamento_id BIGINT UNSIGNED NOT NULL,
    numero_nf VARCHAR(60) NOT NULL,
    serie VARCHAR(10) NULL,
    chave_acesso VARCHAR(60) NULL,
    volumes INT NOT NULL DEFAULT 0,
    peso DECIMAL(12,3) NOT NULL DEFAULT 0,
    valor_nf DECIMAL(14,2) NOT NULL DEFAULT 0,
    observacao TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notas_fiscais_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS documentos (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    agendamento_id BIGINT UNSIGNED NOT NULL,
    tipo_documento VARCHAR(60) NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    url_arquivo VARCHAR(500) NULL,
    mime_type VARCHAR(100) NULL,
    tamanho_bytes BIGINT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_documentos_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS logs_auditoria (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    usuario_id BIGINT UNSIGNED NULL,
    usuario_nome VARCHAR(150) NULL,
    perfil VARCHAR(50) NULL,
    acao VARCHAR(80) NOT NULL,
    entidade VARCHAR(80) NOT NULL,
    entidade_id BIGINT UNSIGNED NULL,
    detalhes JSON NULL,
    ip VARCHAR(45) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_logs_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS regras (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    chave VARCHAR(100) NOT NULL UNIQUE,
    valor VARCHAR(255) NULL,
    tolerancia_atraso_min INT NOT NULL DEFAULT 15,
    tempo_descarga_previsto_min INT NOT NULL DEFAULT 60,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS relatorio_terceirizado (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    row_hash VARCHAR(64) NULL UNIQUE,
    agendamento_id BIGINT UNSIGNED NULL,
    origem_arquivo VARCHAR(255) NULL,
    dados_originais_json JSON NULL,
    referencia_externa VARCHAR(100) NULL,
    fornecedor VARCHAR(191) NULL,
    transportadora VARCHAR(191) NULL,
    motorista VARCHAR(191) NULL,
    cpf_motorista VARCHAR(20) NULL,
    placa VARCHAR(20) NULL,
    quantidade_notas INT NOT NULL DEFAULT 0,
    quantidade_volumes INT NOT NULL DEFAULT 0,
    peso_total_kg DECIMAL(12,3) NULL,
    valor_total_nf DECIMAL(14,2) NULL,
    notas_json JSON NULL,
    status VARCHAR(40) NULL,
    imported_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_relatorio_agendamento FOREIGN KEY (agendamento_id) REFERENCES agendamentos(id)
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
