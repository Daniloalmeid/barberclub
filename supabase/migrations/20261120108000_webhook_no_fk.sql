-- Reversão: adicionar de novo a FK webhook_events.payment_id, se ainda for desejada.
-- A FK faz o INSERT do evento (antes do advisory lock) travar a linha de payments
-- e reabre o deadlock do C08 com cancel_appointment.

alter table public.webhook_events
  drop constraint if exists webhook_events_payment_id_fkey;
