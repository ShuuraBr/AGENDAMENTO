# Testes manuais operacionais

## 1. Check-in QR válido
- Abrir o link ou QR de check-in com token `CHK-*` válido.
- Confirmar retorno `200`.
- Validar mudança de status para `CHEGOU`.
- Confirmar registro em `logs/technical-events.jsonl`.

## 2. Check-in antecipado
- Executar check-in antes da janela permitida.
- Confirmar retorno `409` com `requiresManualAuthorization=true`.
- Validar envio ou tentativa de notificação ao gestor, quando configurado.
- Confirmar motivo de bloqueio registrado no log técnico.

## 3. Check-out sem iniciar descarga
- Executar check-out com status `CHEGOU`.
- Confirmar retorno `409` com `requiresStartUnload=true`.
- Confirmar log técnico com motivo `requires_start_unload`.

## 4. Check-out com avaria sem imagem
- Iniciar descarga.
- Finalizar com `houveAvaria=true` e sem anexos.
- Confirmar finalização do agendamento.
- Confirmar tentativa de envio do e-mail de avaria registrada em `logs/email-dispatch.jsonl`.

## 5. Check-out com avaria e múltiplas imagens
- Enviar 2 ou mais imagens JPG, PNG, WEBP ou HEIC.
- Confirmar upload aceito.
- Confirmar e-mail de avaria com anexos.
- Confirmar rejeição para arquivo acima do limite ou formato inválido.

## 6. Avaliação com data e hora
- Finalizar agendamento.
- Confirmar envio do e-mail de avaliação.
- Validar exibição de data agendada e hora no conteúdo.

## 7. Healthchecks
- `GET /api/health/smtp`
- `GET /api/health/uploads`
- `GET /api/health/notifications`
- Confirmar `200` quando tudo estiver íntegro e `503` quando SMTP não estiver saudável.
