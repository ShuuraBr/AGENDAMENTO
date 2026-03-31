# Deploy

## Configuração correta
A aplicação deve ser iniciada pela pasta raiz do projeto.

Use como referência:
- Root directory: pasta principal do projeto
- Entry file: `server.js`

Não use `backend` como root do Node, porque o ponto de entrada real está na raiz.

## Variáveis mínimas
```env
PORT=3000
FRONTEND_URL=https://agendamento.objetivaatacadista.com.br
JWT_SECRET=troque_essa_chave
DATABASE_URL=mysql://usuario:senha@host:3306/banco
```

## Instalação
```bash
npm install
npm run prisma:generate
```

## Banco
```bash
npm run prisma:push
npm run prisma:seed
```

## Execução
```bash
npm start
```

## Notas importantes
- Gere o zip sem `node_modules`, para evitar problemas de permissão e incompatibilidade entre Windows e Linux.
- O `server.js` da raiz carrega o ambiente e depois sobe `./backend/src/server.js`.
- Se houver erro 503, consulte os logs do processo Node antes de investigar rota ou frontend.
