# Arquitetura MVP

## Fluxos centrais

1. Transportadora cria solicitação de agendamento.
2. Operação interna aprova, reprova ou reageenda.
3. Motorista consulta o protocolo e realiza check-in.
4. Operação registra chegada, início e fim da descarga.
5. Dashboard consolida indicadores do dia.

## Domínios centrais

- Parceiros: fornecedores e transportadoras
- Recursos: docas e janelas
- Operação: agendamentos e ocorrências
- Comunicação: notificações
- Governança: autenticação e auditoria
