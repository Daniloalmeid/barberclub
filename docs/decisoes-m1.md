# Decisões da M1

Quando a especificação 1.6 deixava duas leituras possíveis, ficou a opção mais fechada. Isto é o registro.

## D37

O backup diário roda no cron da VPS, opção A. O papel é o `backup_reader`. Não há workflow de backup no GitHub Actions e o script canônico continua em `/opt/workloop/barberclub/scripts/backup-daily.sh`.

No Supabase local o `postgres` da migration não é superusuário, mas conseguiu `ALTER ROLE backup_reader BYPASSRLS`. O papel fica `LOGIN`, sem `SUPERUSER`, `CREATEDB` ou `CREATEROLE`, com `BYPASSRLS`. `TEMP` e `CREATE` no banco foram revogados. A leitura nova nasce por `ALTER DEFAULT PRIVILEGES` do `postgres` e do `ledger_owner`.

`USAGE` em `auth` e as policies de `storage.objects` não cabem na migration: o `postgres` não tem `GRANT OPTION` no schema `auth` nem é dono de `storage.objects`. O complemento idempotente está em `supabase/admin/superuser.sql`, dentro de `BEGIN`/`COMMIT`. É passo obrigatório de todo banco novo (CI, M2 e M3). Quem executa é o Hermes, com autorização do Danilo. O atalho `scripts/apply-superuser-grants.sh` é só CI e Supabase local (`docker exec` + `trust`). Na M2/M3 self-hosted a senha vira `.pgpass` `chmod 600` montado só de leitura (`PGPASSFILE`), num container efêmero `postgres:17`. Não há `--env-file` nem `-e PGPASSWORD`, porque os dois aparecem em `docker inspect`. No Cloud a senha do `supabase_admin` em geral não existe para o cliente: M2/M3 nesse alvo fica bloqueada até um staging provar o papel `postgres`, como está em `infra/runbooks/deploy-supabase-admin.md`. A conferência entra direto como `backup_reader`: as quatro policies nomeadas, com `authenticated` e `tenant-files` no `qual`/`with_check`, sem exigir que não exista policy de outro bucket. Também confere o bucket `tenant-files` privado, RLS em `storage.objects`, `USAGE` em `auth` e `SELECT` em `auth.users` e `auth.identities`. O `backup_reader` ganha `SELECT` só em `storage.buckets` para essa leitura, sem ver `storage.objects`. Sem o passo, o papel lê as tabelas do produto e mesmo assim não entra em `auth`. Não se usa o `postgres` no backup.

## Middleware

A M1 cria o middleware, então a rejeição de path entra agora, não fica só anotada para a M2. Na entrada, antes de resolver tenant, o app responde 400 para segmento codificado (`%2e`, `%2f`, `%5c`, `%00`, inclusive codificação dupla), dot-segment (`.`, `..`, `..;algo`) e `;` no segmento. A função pura cobre a forma crua. O parser de URL do `NextRequest` já resolve um `..` puro antes do middleware; o caso que sobrevive, e que o advisory aponta, é o `/..;x/`.

## Testes de privilégio

T17 e G09 olham só os schemas do BarberClub (`public`, `public_api`, `server_api`, `private`, `ledger`). Os schemas gerenciados do Supabase têm `SECURITY DEFINER` próprio; alterá-los quebraria Auth e Storage.

G07: o `backup_reader` tem `USAGE` em `server_api` para o dump (D37) e não tem `EXECUTE`. `EXECUTE` continua só no `service_role`.

G10: tabela nova do `postgres` nasce sem privilégio para `anon`, `authenticated` e `service_role`. O `backup_reader` recebe `SELECT` pelo default privilege. É o comportamento pedido na D37.

O `backup_reader` não executa função `SECURITY DEFINER` dos nossos schemas. Funções do schema `auth` continuam executáveis por `PUBLIC` porque revogar isso quebra o Auth. Não há `GRANT` direto para o `backup_reader`.

## Ledger e agenda

A ordem de row lock escrita na seção 5.3.1 vale: `appointments`, depois `payments`, depois `staff_busy`, depois `refund_requests`. O advisory do profissional vem antes de qualquer row lock. O `INSERT` em `webhook_events` continua antes do advisory: a deduplicação do evento responde sem esperar o lock do profissional. `webhook_events.tenant_id` é `NOT NULL`. `process_payment_event` e `record_refund_result` gravam o par `(tenant_id, payment_id)` lido de `payments` sem `FOR UPDATE`. A FK composta para `payments (tenant_id, id)` é `DEFERRABLE INITIALLY DEFERRED`, com índice em `(tenant_id, payment_id)`. A checagem, e o `FOR KEY SHARE`, cai no `COMMIT`, depois do advisory e do `FOR UPDATE` nos caminhos que seguem. Uma FK imediata travava o pagamento no `INSERT` e o C08 voltava a dar deadlock. Nenhum caminho usa `SET CONSTRAINTS IMMEDIATE` nessa constraint.

`tenant_id NOT NULL` entra na mesma migration que o `CREATE OR REPLACE` das duas funções. A transação só commita com a coluna obrigatória e com as funções já gravando o par. A imagem antiga não tem `INSERT` em `webhook_events`: o único caminho é `server_api`, que passa a ser a função nova no mesmo commit do banco. Entre a migration e a troca da imagem não existe estado em que a coluna rejeita o `INSERT` que a função antiga faria, porque essa função antiga já não está instalada.

`refunds` e `refund_requests` trocam a FK imediata só em `payments(id)` pela composta `(tenant_id, payment_id)`, também imediata. Os três chamadores (`cancel_appointment`, `process_payment_event`, `record_refund_result`) já seguram o advisory e o `FOR UPDATE` de `payments` antes do `INSERT`. O `FOR KEY SHARE` da FK cai na linha que a mesma transação já trava, então deferir essas duas não muda a ordem e elas ficam imediatas.

Os triggers de soma zero do ledger e os de coerência do `staff_busy` são `SECURITY DEFINER`. No `COMMIT`, o Postgres os executa com o usuário da sessão. Sem isso, `service_role` e `authenticated` não leem o ledger nem o `staff_busy` e o commit falha mesmo quando a função dona escreveu certo.

`book_appointment` trata `unique_violation` da chave de idempotência e devolve a reserva existente quando o hash coincide. Duas sessões do mesmo cliente não ficam as duas com erro.

O catálogo público só devolve tenant `trial` ou `active`. `past_due` e `suspended` não aparecem e a reserva nova é recusada (`tenant_not_bookable`). Reserva já paga não é apagada.

Pagamento no local é o padrão (`pay_at_location`, PIX desligado). O papel `manager` existe nas policies; a tela de convite fica para a M7.

## Fora desta etapa

Não há imagem no GHCR, projeto Supabase na nuvem, DNS, Traefik, token ou dado fictício fora das fixtures de teste. O digest da imagem Node fica para o build que for publicado. O Dockerfile está no repositório como alvo de handoff, sem ser construído no CI.
