# Requisitos da M3

## Webhook do gateway

`server_api.process_payment_event` e `server_api.record_refund_result` levantam `payment_not_found` (`P0002`) quando o pagamento não existe. Esse caminho não grava em `webhook_events`. A coluna `payment_id` é `NOT NULL` (`docs/decisoes-m1-1.md`).

O handler HTTP da M3, ao receber `P0002`:

- responde erro ao gateway, para ele reentregar;
- alerta;
- não responde sucesso.

Um teste do handler falha se um evento sem payment conhecido for aceito ou se surgir linha em `webhook_events`.
