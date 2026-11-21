# Deploy do SQL de supabase_admin

Quem executa é o Hermes, com autorização do Danilo. O log fica em `/var/log/barberclub/deploy-supabase-admin.log`, na máquina de quem roda o comando, fora do container da app e fora do ambiente do Easypanel. O diretório é `0750`.

Cada passo grava data, `executor=hermes`, `autorizado=danilo` e o commit. Verify e health check gravam a saída e o exit code, com `pipefail` para o status não ser o do `tee`:

```bash
set -o pipefail
LOG=/var/log/barberclub/deploy-supabase-admin.log
GIT_COMMIT=$(git rev-parse HEAD)
printf '%s executor=hermes autorizado=danilo commit=%s\n' "$(date -Is)" "$GIT_COMMIT" | tee -a "$LOG"
scripts/verify-superuser-grants.sh 2>&1 | tee -a "$LOG"
verify_exit=${PIPESTATUS[0]}
printf 'verify_exit=%s\n' "$verify_exit" | tee -a "$LOG"
curl -fsS "$ORIGIN/api/health/live" 2>&1 | tee -a "$LOG"
live_exit=${PIPESTATUS[0]}
printf 'health_live_exit=%s\n' "$live_exit" | tee -a "$LOG"
curl -fsS "$ORIGIN/api/health" 2>&1 | tee -a "$LOG"
health_exit=${PIPESTATUS[0]}
printf 'health_exit=%s\n' "$health_exit" | tee -a "$LOG"
```

Não entra senha, DSN, env-file nem conteúdo de `.pgpass`.

`supabase/admin/superuser.sql` não faz parte das migrations. O papel que aplica o schema não tem `GRANT OPTION` em `auth` e não é dono de `storage.objects`. Sem este passo, `backup_reader` não lê `auth.users` nem `auth.identities`, e o bucket `tenant-files` não fica com as quatro policies. O arquivo abre com `BEGIN` e fecha com `COMMIT`: um erro no meio desfaz o `DROP POLICY`.

É obrigatório em todo banco novo e na M2/M3 self-hosted, depois das migrations e antes de subir a imagem nova. No Supabase Cloud o deploy fica bloqueado até o registro de staging da seção própria.

O script `scripts/apply-superuser-grants.sh` é só o atalho do CI e do Supabase local (`docker exec` + `trust`). Não serve para o banco alvo.

## Credencial

O DSN não entra em argumento. A senha não entra em `--env-file` nem em `-e PGPASSWORD`: num `docker run` nomeado os dois aparecem em `docker inspect`. O arquivo de trabalho é um `.pgpass` `chmod 600`, montado só de leitura em `PGPASSFILE`. `scripts/psql-from-env-file.sh` não copia a credencial para `/tmp`. Se a origem já é `.pgpass`, monta o arquivo original. Se a origem é env-file, converte para `.pgpass` num tmpfs (`/run/secrets` ou `/dev/shm`) e apaga com `shred -u`.

Preparar o `.pgpass`, sem a senha no histórico:

```bash
install -d -m 700 /run/secrets
install -m 600 /dev/null /run/secrets/admin.pgpass
read -rs -p 'senha: ' PGPASSWORD
printf '\n'
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" 'supabase_admin' "$PGPASSWORD" > /run/secrets/admin.pgpass
unset PGPASSWORD
chmod 600 /run/secrets/admin.pgpass
```

O mesmo para `/run/secrets/migrate.pgpass` (usuário `postgres`) e `/run/secrets/backup-reader.pgpass` (usuário `backup_reader`). No fim:

```bash
shred -u /run/secrets/admin.pgpass /run/secrets/migrate.pgpass /run/secrets/backup-reader.pgpass
```

Senha com `:` ou `\` escrita à mão precisa de `\:` e `\\`. O script faz esse escape quando converte um env-file.

TLS: o script repassa `PGSSLMODE` e, se `PGSSLROOTCERT` for arquivo, monta o certificado `:ro`. Fora de `localhost` / `127.0.0.1` / `::1`, `PGSSLMODE` vazio vira `verify-full`. Host do Supabase Cloud (`*.supabase.co`, `*.supabase.com`, `*.pooler.supabase.com`) só aceita `verify-full`.

Conexão: porta `5432` direta, ou o session pooler na porta `5432`. O transaction pooler na porta `6543` não serve para `psql`, migration nem `pg_dump`; o script recusa essa porta.

## Ordem

1. Congelar o deploy da imagem nova. Anotar no log o commit, `executor=hermes` e `autorizado=danilo`.
2. Backup lógico, ou dispensa registrada. Detalhe abaixo.
3. Aplicar só as migrations pendentes, com o `.pgpass` do papel `postgres` (não é `supabase_admin` nem `backup_reader`). Cada arquivo roda com `--single-transaction`. Falha congela o deploy; a correção é uma migration nova (fix-forward), sem editar a que falhou.

```bash
applied=$(BARBERCLUB_PG_ENV_FILE=/run/secrets/migrate.pgpass \
  scripts/psql-from-env-file.sh -tA -c "select version from supabase_migrations.schema_migrations")
for f in supabase/migrations/*.sql; do
  ver=$(basename "$f" .sql)
  ver=${ver%%_*}
  if grep -qx "$ver" <<< "$applied"; then
    continue
  fi
  BARBERCLUB_PG_ENV_FILE=/run/secrets/migrate.pgpass \
    scripts/psql-from-env-file.sh --single-transaction "$f" \
    || { printf 'migration_falhou=%s\n' "$ver" | tee -a "$LOG"; exit 1; }
  BARBERCLUB_PG_ENV_FILE=/run/secrets/migrate.pgpass \
    scripts/psql-from-env-file.sh -v "ver=$ver" -c \
    "insert into supabase_migrations.schema_migrations (version) values (:'ver')"
done
```

`supabase db push --db-url` só entra se a URL não tiver senha e o `PGPASSFILE` estiver apontado. O CI local não usa esse caminho: `supabase start` aplica pelo socket `trust`.

4. Aplicar `supabase/admin/superuser.sql` com o `.pgpass` do `supabase_admin`.

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass \
  scripts/psql-from-env-file.sh supabase/admin/superuser.sql
```

5. Verificar entrando direto como `backup_reader`. O arquivo é `/run/secrets/backup-reader.pgpass`. Sem `SET ROLE` e sem fallback `docker exec` + `trust` (esse fallback só existe com `BARBERCLUB_VERIFY_LOCAL=1`, e só no CI).

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/backup-reader.pgpass \
  scripts/verify-superuser-grants.sh 2>&1 | tee -a "$LOG"
verify_exit=${PIPESTATUS[0]}
printf 'verify_exit=%s\n' "$verify_exit" | tee -a "$LOG"
```

Exit diferente de 0 congela o deploy.

6. Só então subir a imagem nova.
7. `GET /api/health/live` responde `{"status":"ok"}`. `GET /api/health` responde `status=ok` e `commit` igual ao SHA do passo 1. Saída e exit code vão para o log, no formato do cabeçalho.
8. Smoke com um usuário de teste do próprio projeto: upload e leitura em `tenant-files`, no prefixo do tenant. Apagar o objeto ao terminar. Não usar token de produção no repositório.

`webhook_events.tenant_id NOT NULL` não exige expand/contract. O `INSERT` do evento não está na imagem: só existe em `server_api.process_payment_event` e `server_api.record_refund_result`. A migration `20261121100000` troca essas funções e torna a coluna obrigatória na mesma transação. A imagem que ainda está no ar, entre esse commit do banco e o passo 6, chama a função nova.

### Backup do passo 2

Schemas que o `backup_reader` já lê antes do passo 4, pelas migrations: `public`, `private`, `ledger`, `public_api`, `server_api`. `private`, `public_api` e `server_api` não têm tabela; entram no dump pelas funções visíveis. `auth` e `storage.objects` ainda não. O script canônico `backup-daily.sh` não está no repositório; flags além de `postgres:17` e do papel `backup_reader` continuam NÃO CONFIRMADAS. Este dump da janela usa a lista abaixo, não `--env-file`.

```bash
install -d -m 700 /var/backups/barberclub
ssl_env=()
[[ -n "${PGSSLMODE:-}" ]] && ssl_env+=(-e "PGSSLMODE=${PGSSLMODE}")
[[ -n "${PGSSLROOTCERT:-}" ]] && ssl_env+=(-e "PGSSLROOTCERT=${PGSSLROOTCERT}")
docker run --name "barberclub-dump-$$" --network host \
  -e PGHOST -e PGPORT -e PGDATABASE \
  -e PGUSER=backup_reader \
  -e PGPASSFILE=/pgpass/pgpass \
  "${ssl_env[@]}" \
  -v /run/secrets/backup-reader.pgpass:/pgpass/pgpass:ro \
  -v /var/backups/barberclub:/dump \
  postgres:17 \
  pg_dump -Fc \
    -n public -n private -n ledger -n public_api -n server_api \
    -f "/dump/pre-deploy-${GIT_COMMIT}.dump"
docker rm -f "barberclub-dump-$$" >/dev/null 2>&1 || true
test -s "/var/backups/barberclub/pre-deploy-${GIT_COMMIT}.dump"
n=$(docker run --rm -v /var/backups/barberclub:/dump:ro postgres:17 \
  pg_restore --list "/dump/pre-deploy-${GIT_COMMIT}.dump" | awk '$4 == "TABLE" { c++ } END { print c+0 }')
test "$n" -eq 28
```

As 28 tabelas são as 25 de `public` (`admin_cases`, `appointments`, `audit_log`, `customers`, `memberships`, `outbox_events`, `payments`, `plans`, `platform_admins`, `profiles`, `rate_limits`, `refund_requests`, `refunds`, `services`, `staff`, `staff_busy`, `staff_services`, `subscriptions`, `tenant_branding`, `tenant_domains`, `tenant_settings`, `tenants`, `time_off`, `webhook_events`, `work_schedules`) e as 3 de `ledger` (`accounts`, `journal_entries`, `journal_lines`). O diretório não é o corrente.

Depois do passo 4, um segundo dump só das tabelas de `auth` que o grant libera:

```bash
docker run --name "barberclub-dump-auth-$$" --network host \
  -e PGHOST -e PGPORT -e PGDATABASE \
  -e PGUSER=backup_reader \
  -e PGPASSFILE=/pgpass/pgpass \
  "${ssl_env[@]}" \
  -v /run/secrets/backup-reader.pgpass:/pgpass/pgpass:ro \
  -v /var/backups/barberclub:/dump \
  postgres:17 \
  pg_dump -Fc -t auth.users -t auth.identities \
    -f "/dump/pre-deploy-${GIT_COMMIT}-auth.dump"
docker rm -f "barberclub-dump-auth-$$" >/dev/null 2>&1 || true
test -s "/var/backups/barberclub/pre-deploy-${GIT_COMMIT}-auth.dump"
n=$(docker run --rm -v /var/backups/barberclub:/dump:ro postgres:17 \
  pg_restore --list "/dump/pre-deploy-${GIT_COMMIT}-auth.dump" | awk '$4 == "TABLE" { c++ } END { print c+0 }')
test "$n" -eq 2
```

`PGHOST`, `PGPORT` e `PGDATABASE` vêm do ambiente do operador, sem senha. `PGUSER` fica fixo em `backup_reader`.

Dispensa: só quando os três estão vazios, lidos por um papel que enxerga os três (`supabase_admin` no self-hosted, pelo `.pgpass` dele). `backup_reader` ainda não lê `auth.users` nem `storage.objects` neste passo.

```bash
counts=$(BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass \
  scripts/psql-from-env-file.sh -tA -c \
  "select (select count(*) from public.tenants), (select count(*) from auth.users), (select count(*) from storage.objects)")
```

Se a relação `public.tenants` ainda não existe, o banco é novo: conferir só `auth.users` e `storage.objects`. Os três em zero (ou o schema de produto ausente e os outros dois em zero) dispensa o dump. Registrar `backup dispensado: banco sem dados`. Qualquer linha em um dos três obriga o dump.

## Self-hosted

O verificador, já conectado como `backup_reader`, confere:

- as policies `tenant_objects_select` (`SELECT`), `tenant_objects_insert` (`INSERT`), `tenant_objects_update` (`UPDATE`) e `tenant_objects_delete` (`DELETE`), todas `PERMISSIVE`, com `roles = {authenticated}`, e o `qual` / `with_check` igual à expressão com `tenant-files`, `foldername` e `has_role` (no `UPDATE`, os dois lados). `OR true` não passa
- o bucket `tenant-files` com `public = false`
- RLS ligado em `storage.objects`
- `USAGE` em `auth` e `SELECT` em `auth.users` e `auth.identities`
- `backup_reader` sem `SELECT` em `storage.objects`

Policy de outro bucket não entra na conta. O `SELECT` em `storage.buckets` é só o metadado do bucket.

## Supabase Cloud

BLOQUEIO. M2 e M3 em Supabase Cloud não seguem enquanto um projeto de staging não registrar no log que o papel `postgres` desse projeto conseguiu `CREATE POLICY` em `storage.objects` e `GRANT USAGE` em `auth` mais `SELECT` em `auth.users` e `auth.identities` para o `backup_reader`. O registro leva o comando e o resultado (sucesso ou o erro). Sem isso o deploy Cloud não abre.

Comando no staging, com o `.pgpass` do papel `postgres` do projeto, porta `5432` (direto ou session pooler) e `PGSSLMODE=verify-full`:

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/cloud-postgres.pgpass \
  PGSSLMODE=verify-full \
  scripts/psql-from-env-file.sh supabase/admin/superuser.sql
```

Se `CREATE POLICY` falhar porque o dono de `storage.objects` é `supabase_storage_admin`, parar. O papel `postgres` do Cloud não assume esse dono. O deploy continua bloqueado até o suporte do Supabase, ou uma sessão como `supabase_storage_admin`, aplicar o bloco das policies. Não marcar o passo como feito.

Depois do staging aprovado, a verificação no Cloud é o script pela rede, com a credencial do `backup_reader`, não consulta colada no SQL editor:

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/backup-reader.pgpass \
  PGSSLMODE=verify-full \
  scripts/verify-superuser-grants.sh
```

## Rollback

Quem executa é o Hermes, com autorização do Danilo. A app volta para a imagem anterior.

Se a versão anterior de `supabase/admin/superuser.sql` já tem `BEGIN`/`COMMIT`, reaplica-se o arquivo. Se não tem, a reaplicação usa `--single-transaction`, para um erro no meio não deixar o storage sem policy:

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass \
  scripts/psql-from-env-file.sh --single-transaction supabase/admin/superuser.sql
```

Em seguida o verify roda de novo e o log guarda saída e exit code. Exit diferente de 0 mantém o deploy congelado.

Os grants novos (`USAGE` em `storage` e `SELECT` em `storage.buckets`) permanecem: a versão anterior não tem `REVOKE`, e eles só expõem o metadado do bucket. Desfazer, com autorização do Danilo:

```sql
revoke select on storage.buckets from backup_reader;
revoke usage on schema storage from backup_reader;
```

Depois disso o verify falha na leitura do bucket até o SQL atual voltar. Rodar o verify outra vez e registrar o exit code.

Primeiro deploy, sem versão anterior: não há o que reaplicar. Não restaurar o dump sem autorização do Danilo. Não dropar `tenant-files` enquanto houver objeto. O verify roda mesmo assim.
