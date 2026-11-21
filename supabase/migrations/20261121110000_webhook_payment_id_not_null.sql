-- DECISÃO: webhook_events.payment_id é obrigatório.
-- Evento sem pagamento conhecido não grava linha: as funções levantam
-- payment_not_found (P0002) antes do INSERT. Esta migration não apaga
-- linha. Se ainda houver payment_id nulo, a contagem faz a transação falhar.

do $pre$
declare
  sem_payment bigint;
begin
  select count(*) into sem_payment
    from public.webhook_events
   where payment_id is null;
  if sem_payment > 0 then
    raise exception
      'webhook_events.payment_id: % linha(s) com payment_id nulo. Não apague; corrija antes do SET NOT NULL.',
      sem_payment;
  end if;
end
$pre$;

alter table public.webhook_events
  alter column payment_id set not null;
