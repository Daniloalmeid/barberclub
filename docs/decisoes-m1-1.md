# Decisões da M1.1

## DECISÃO: webhook_events.payment_id proíbe NULL

`payment_id` passa a ser `NOT NULL`. A migration `20261121110000` conta as linhas com `payment_id` nulo e falha com essa contagem. Não apaga linha.

`server_api.process_payment_event` e `server_api.record_refund_result` continuam levantando `payment_not_found` (`P0002`) quando o pagamento não existe, e o `INSERT` em `webhook_events` fica depois dessa checagem. Evento de gateway sem payment conhecido não grava linha.

O handler HTTP que recebe o webhook é da M3. O requisito está em `docs/requisitos-m3.md`: responder erro para o gateway reentregar, e alertar.
