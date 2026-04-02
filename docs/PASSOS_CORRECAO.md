# Passos da correção

1. No banco MySQL, execute o SQL de `docs/ALTERS_V3.sql`.
2. No painel da hospedagem, faça upload deste pacote substituindo o projeto atual.
3. Não envie `backend/node_modules` do Windows para a hospedagem Linux.
4. Faça um Redeploy/Restart do app Node no painel.
5. Teste:
   - `/api/health`
   - `/api/health/db`
   - `/api/dashboard/operacional`
   - `/api/dashboard/docas`

## O que foi corrigido

- `Agendamento` agora está alinhado ao schema com `checkoutToken`, `cpfMotorista`, `pesoTotalKg` e `valorTotalNf`.
- Criação de agendamento interno salva cabeçalho e `NotaFiscal` em transação no banco.
- Solicitação pública também salva `NotaFiscal` em transação e não tenta gravar `lgpdConsent` como coluna inexistente.
- Fallback do dashboard foi reforçado para SQL bruto e arquivo.
- O painel de docas em fallback por arquivo foi corrigido.
