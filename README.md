# Agendamento de Descarga

Base inicial de um monorepo para uma aplicação web de agendamento e gestão de descarga de mercadorias.

## Estrutura

```text
agendamento-descarga/
  backend/      # API Node.js + Express + Prisma
  frontend/     # React + Vite
  shared/       # tipos e contratos compartilhados
  docs/         # documentação técnica
  .github/      # workflows e automações
```

## Objetivo do MVP

- Agendamento por transportadora/fornecedor
- Confirmação e check-in do motorista
- Painel operacional interno
- Controle de status da descarga
- Dashboard básico do dia
- Voucher de confirmação (fase seguinte)

## Stack sugerida

### Frontend
- React
- Vite
- React Router
- Axios
- React Hook Form
- Zod

### Backend
- Node.js
- Express
- Prisma ORM
- JWT
- Multer

### Banco
- MySQL

## Como rodar localmente

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

### 2. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

## Estrutura inicial dos módulos

### Backend
- `auth`: autenticação e autorização
- `users`: usuários internos
- `fornecedores`: cadastro de fornecedores
- `transportadoras`: cadastro de transportadoras
- `motoristas`: cadastro de motoristas
- `veiculos`: cadastro de veículos
- `docas`: parametrização das docas
- `janelas`: janelas de agendamento
- `agendamentos`: solicitação, aprovação e status
- `operacao`: chegada, descarga e encerramento
- `documentos`: anexos e validações
- `notificacoes`: e-mail e WhatsApp
- `dashboards`: KPIs operacionais
- `auditoria`: trilha de alterações

### Frontend
- páginas públicas
- portal do motorista
- portal da transportadora
- autenticação
- dashboard interno
- telas de agendamento, operação e cadastros

## Deploy GitHub -> Hostinger

1. Subir o repositório ao GitHub.
2. Configurar variáveis de ambiente no ambiente da Hostinger.
3. Publicar o backend Node.js.
4. Publicar o frontend com build Vite.
5. Configurar domínio/subdomínio e URL da API.

## Observações

Esta base foi preparada para servir como ponto de partida limpo e organizado. Ainda não contém regras completas de negócio nem telas finais, mas já organiza o projeto para evolução incremental.
