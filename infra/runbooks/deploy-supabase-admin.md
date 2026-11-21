# Deploy do SQL de supabase_admin

Quem executa é o Hermes, com autorização do Danilo. O log fica em `/var/log/barberclub/deploy-supabase-admin.log` na máquina de quem roda o comando, fora do container da app e fora do ambiente do Easypanel. Cada linha leva data, executor, commit e o status do passo. Não entra senha, DSN, env-file nem conteúdo de `.pgpass`.

`supabase/admin/superuser.sql` não faz parte das migrations. O papel que aplica o schema não tem `GRANT OPTION` em `auth` e não é dono de `storage.objects`. Sem este passo, `backup_reader` não lê `auth.users` nem `auth.identities`, e o bucket `tenant-files` não fica com as quatro policies. O arquivo abre com `BEGIN` e fecha com `COMMIT`: um erro no meio desfaz o `DROP POLICY`, em vez de deixar o storage sem policy.

É obrigatório em todo banco novo, na M2 e na M3, depois das migrations e antes de subir a imagem nova.

O script `scripts/apply-superuser-grants.sh` é só o atalho do CI e do Supabase local (`docker exec` + `trust`). Não serve para o banco alvo da M2/M3.

## Ordem

1. Congelar o deploy da imagem nova e anotar o commit (`git rev-parse HEAD`) no log.
2. Backup lógico com `pg_dump` na imagem `postgres:17`, papel `backup_reader`, credencial por `--env-file`. Conferir que o arquivo não está vazio (`test -s`). O cron diário continua no script da VPS; este dump é o da janela de deploy.
3. Aplicar as migrations.
4. Aplicar `supabase/admin/superuser.sql`.
5. Rodar `scripts/verify-superuser-grants.sh`. Se sair diferente de 0, não seguir.
6. Só então subir a imagem nova.
7. `GET /api/health/live` responde `{"status":"ok"}`. `GET /api/health` responde `status=ok` e `commit` igual ao SHA anotado no passo 1 (`GIT_COMMIT` da imagem).
8. Smoke com um usuário de teste do próprio projeto: upload e leitura de um objeto em `tenant-files`, no prefixo do tenant. Apagar o objeto de teste ao terminar. Não usar token de produção no repositório.

```bash
docker run --rm --network host \
  --env-file /run/secrets/backup-reader.env \
  -v "$PWD:/dump" \
  postgres:17 \
  pg_dump -Fc -f /dump/pre-deploy.dump
test -s pre-deploy.dump
```

`/run/secrets/backup-reader.env` está em `chmod 600` e some no fim da janela. Não usar `-e PGPASSWORD=`.

## Credencial

O DSN não entra em argumento. O arquivo (`chmod 600`) é lido por `BARBERCLUB_PG_ENV_FILE`. O script copia, monta a cópia num container efêmero `postgres:17` e apaga a cópia e o container no `trap`. A senha não vai em `-e PGPASSWORD=`, nem na linha do `psql`, nem no ambiente persistente da app ou do Easypanel.

Env-file (`PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`), passado com `--env-file`:

```bash
install -m 600 /dev/null /run/secrets/admin.env
# preencher a partir do cofre, sem ecoar
BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.env \
  scripts/psql-from-env-file.sh supabase/admin/superuser.sql
shred -u /run/secrets/admin.env
```

`.pgpass` (`hostname:port:database:username:password`), montado só de leitura. Senha com `:` usa o env-file.

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass \
  scripts/psql-from-env-file.sh supabase/admin/superuser.sql
```

A verificação usa outro arquivo, de um papel que não é superusuário e consegue `SET ROLE backup_reader` (no schema deste repositório, o `postgres` da migration recebe esse `GRANT`). Não apontar o arquivo do `supabase_admin` para o verificador.

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/read.env \
  scripts/verify-superuser-grants.sh
```

## Self-hosted

O `supabase_admin` existe e a senha fica no cofre. Aplicar e verificar pelos comandos acima. O verificador confere, como `backup_reader`:

- `pg_policies` em `storage.objects` tem exatamente `tenant_objects_select` (`SELECT`), `tenant_objects_insert` (`INSERT`), `tenant_objects_update` (`UPDATE`) e `tenant_objects_delete` (`DELETE`)
- o bucket `tenant-files` existe com `public = false`
- RLS ligado em `storage.objects`
- `has_schema_privilege(backup_reader, auth, USAGE)` e `SELECT` em `auth.users` e `auth.identities`

`GRANT SELECT` em `storage.buckets` para o `backup_reader` existe só para esta leitura. Não há `SELECT` em `storage.objects`.

## Supabase Cloud

O cliente do projeto em geral não recebe a senha do `supabase_admin`. O caminho `docker exec` + `trust` e o env-file de superusuário não se aplicam.

O que dá para tentar com o papel `postgres` do projeto, no SQL editor do dashboard: colar `supabase/admin/superuser.sql` (ele já abre transação) e, em outra sessão com o mesmo papel, rodar as consultas do verificador depois de `SET ROLE backup_reader`. Se o dashboard recusar `CREATE POLICY` em `storage.objects` ou `GRANT` em `auth`, o caminho é o suporte do Supabase aplicar esse SQL.

PENDENTE DE CONFIRMAÇÃO: se o papel `postgres` do Cloud é dono de `storage.objects`, se ele pode `GRANT USAGE` em `auth`, e se o SQL editor deixa `SET ROLE backup_reader`. Isso não foi executado contra um projeto Cloud.

## Rollback

A app volta para a imagem anterior. No banco, reaplica-se a versão anterior de `supabase/admin/superuser.sql`: o arquivo é idempotente (`DROP POLICY IF EXISTS`, `CREATE POLICY`, `ON CONFLICT DO NOTHING`). Não dropar o bucket `tenant-files` enquanto houver objeto dentro. Restore do dump só em último caso, com autorização do Danilo.
