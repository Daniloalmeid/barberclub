# Deploy do SQL de supabase_admin

Quem executa é o Hermes, com autorização do Danilo. O log fica em `/var/log/barberclub/deploy-supabase-admin.log` na máquina de quem roda o comando, fora do container da app e fora do ambiente do Easypanel. O diretório é `0750`. Cada passo grava data, `executor=hermes`, `autorizado=danilo` e o commit. O verify e o health check gravam a saída inteira e o exit code. Não entra senha, DSN, env-file nem conteúdo de `.pgpass`.

`supabase/admin/superuser.sql` não faz parte das migrations. O papel que aplica o schema não tem `GRANT OPTION` em `auth` e não é dono de `storage.objects`. Sem este passo, `backup_reader` não lê `auth.users` nem `auth.identities`, e o bucket `tenant-files` não fica com as quatro policies. O arquivo abre com `BEGIN` e fecha com `COMMIT`: um erro no meio desfaz o `DROP POLICY`, em vez de deixar o storage sem policy.

É obrigatório em todo banco novo, na M2 e na M3 self-hosted, depois das migrations e antes de subir a imagem nova. No Supabase Cloud este runbook está bloqueado até o teste de staging da seção própria.

O script `scripts/apply-superuser-grants.sh` é só o atalho do CI e do Supabase local (`docker exec` + `trust`). Não serve para o banco alvo da M2/M3.

## Credencial

O DSN não entra em argumento. A senha não entra em `--env-file` nem em `-e PGPASSWORD`: num `docker run` nomeado os dois aparecem em `docker inspect` (`Config.Env`). O arquivo de trabalho é um `.pgpass` `chmod 600`, montado só de leitura em `PGPASSFILE`. `scripts/psql-from-env-file.sh` aceita um env-file `KEY=VALUE` e ele mesmo gera esse `.pgpass` temporário, apagado no `trap` com `shred -u`.

Preparar o `.pgpass` do `supabase_admin` (self-hosted), sem a senha no histórico:

```bash
install -d -m 700 /run/secrets
install -m 600 /dev/null /run/secrets/admin.pgpass
read -rs -p 'senha supabase_admin: ' PGPASSWORD
printf '\n'
printf '%s:%s:%s:%s:%s\n' "$PGHOST" "$PGPORT" "$PGDATABASE" 'supabase_admin' "$PGPASSWORD" > /run/secrets/admin.pgpass
unset PGPASSWORD
chmod 600 /run/secrets/admin.pgpass
```

O mesmo para o papel das migrations (`postgres`) em `/run/secrets/migrate.pgpass` e para o verificador (`backup_reader`) em `/run/secrets/backup-reader.env` ou `/run/secrets/backup-reader.pgpass`. No fim de cada uso:

```bash
shred -u /run/secrets/admin.pgpass
shred -u /run/secrets/migrate.pgpass
shred -u /run/secrets/backup-reader.pgpass /run/secrets/backup-reader.env
```

Senha com `:` ou `\` precisa ser escapada no `.pgpass` escrito à mão (`\:` e `\\`). O script faz esse escape quando a origem é env-file.

## Ordem

1. Congelar o deploy da imagem nova. Anotar no log o commit (`git rev-parse HEAD`), `executor=hermes` e `autorizado=danilo`.
2. Backup lógico, ou dispensa registrada. Detalhe abaixo.
3. Aplicar as migrations com o papel `postgres`, pelo `.pgpass` de migration. Não é o `supabase_admin` e não é o `backup_reader`.

```bash
for f in supabase/migrations/*.sql; do
  BARBERCLUB_PG_ENV_FILE=/run/secrets/migrate.pgpass \
    scripts/psql-from-env-file.sh "$f"
done
```

O CI local não usa esse caminho: `supabase start` aplica as migrations pelo socket `trust`.

4. Aplicar `supabase/admin/superuser.sql` com o `.pgpass` do `supabase_admin`.

```bash
BARBERCLUB_PG_ENV_FILE=/run/secrets/admin.pgpass \
  scripts/psql-from-env-file.sh supabase/admin/superuser.sql
```

5. Rodar o verificador, que entra direto como `backup_reader` com `/run/secrets/backup-reader.env`. Sem `SET ROLE`. Se sair diferente de 0, não seguir. Gravar saída e exit code no log.

```bash
scripts/verify-superuser-grants.sh
```

6. Só então subir a imagem nova.
7. `GET /api/health/live` responde `{"status":"ok"}`. `GET /api/health` responde `status=ok` e `commit` igual ao SHA do passo 1 (`GIT_COMMIT` da imagem). Gravar os dois corpos e os dois exit codes no log.
8. Smoke com um usuário de teste do próprio projeto: upload e leitura de um objeto em `tenant-files`, no prefixo do tenant. Apagar o objeto de teste ao terminar. Não usar token de produção no repositório.

### Backup do passo 2

O script canônico `/opt/workloop/barberclub/scripts/backup-daily.sh` não está neste repositório. `docs/artefatos-vps.md` só confirma a imagem `postgres:17`, o papel `backup_reader` e que o cron da VPS hoje manda a senha por `--env-file`. Flags e schemas desse script: NÃO CONFIRMADO.

Neste deploy a senha não vai por `--env-file`. O dump da janela, quando existe, é `pg_dump -Fc` como `backup_reader`, com `.pgpass`. Não passar `--schema=auth` nem incluir `storage`: neste momento do passo 2 o `backup_reader` ainda pode não ter `USAGE` em `auth` nem `SELECT` em `storage.objects` (isso só nasce no passo 4). Se o cron da VPS usar outras flags, elas continuam só lá até alguém conferir o arquivo canônico.

Banco novo ou sem dados de produto (schema ainda ausente, ou `public.tenants` com zero linhas): não gerar dump. Registrar no log `backup dispensado: banco sem dados`.

Quando houver dados, o arquivo fica em `/var/backups/barberclub` (`0700`), nunca no diretório corrente:

```bash
install -d -m 700 /var/backups/barberclub
BARBERCLUB_PG_ENV_FILE=/run/secrets/backup-reader.pgpass \
  docker run --name "barberclub-dump-$$" --network host \
  -e PGHOST -e PGPORT -e PGDATABASE -e PGUSER \
  -e PGPASSFILE=/pgpass/pgpass \
  -v /run/secrets/backup-reader.pgpass:/pgpass/pgpass:ro \
  -v /var/backups/barberclub:/dump \
  postgres:17 \
  pg_dump -Fc -f "/dump/pre-deploy-${GIT_COMMIT}.dump"
docker rm -f "barberclub-dump-$$" >/dev/null 2>&1 || true
test -s "/var/backups/barberclub/pre-deploy-${GIT_COMMIT}.dump"
docker run --rm \
  -v /var/backups/barberclub:/dump:ro \
  postgres:17 \
  pg_restore --list "/dump/pre-deploy-${GIT_COMMIT}.dump" >/dev/null
```

`PGHOST`, `PGPORT`, `PGDATABASE` e `PGUSER` vêm do ambiente do operador, sem a senha. O container do `pg_dump` não é nomeado com `--env-file`.

## Self-hosted

O `supabase_admin` existe e a senha fica no cofre, no `.pgpass` acima. O verificador confere, já conectado como `backup_reader`:

- as policies `tenant_objects_select` (`SELECT`), `tenant_objects_insert` (`INSERT`), `tenant_objects_update` (`UPDATE`) e `tenant_objects_delete` (`DELETE`), cada uma com `roles = {authenticated}` e `tenant-files` no `qual` ou no `with_check` (no `UPDATE`, nos dois)
- o bucket `tenant-files` existe com `public = false`
- RLS ligado em `storage.objects`
- `USAGE` em `auth` e `SELECT` em `auth.users` e `auth.identities`

Policy de outro bucket em `storage.objects` não falha a checagem. No Cloud isso é o caso esperado; contamos só as quatro nomes. `GRANT SELECT` em `storage.buckets` existe só para esta leitura. Não há `SELECT` em `storage.objects`.

## Supabase Cloud

BLOQUEIO. M2 e M3 em Supabase Cloud não seguem enquanto um projeto de staging não registrar, no log, que o papel `postgres` desse projeto conseguiu as duas coisas: `CREATE POLICY` em `storage.objects`, e `GRANT USAGE` em `auth` mais `SELECT` em `auth.users` e `auth.identities` para o `backup_reader`. O registro leva o resultado (sucesso ou o erro devolvido). Sem esse registro o deploy Cloud não abre.

A senha do `supabase_admin` em geral não chega ao cliente. O `docker exec` + `trust` não se aplica. Depois do staging aprovado, a verificação no Cloud é o próprio `scripts/verify-superuser-grants.sh` pela rede, com `/run/secrets/backup-reader.env` (`PGUSER=backup_reader`). Não vale colar as consultas à mão no SQL editor.

## Rollback

A app volta para a imagem anterior. No banco, se já existe uma versão anterior de `supabase/admin/superuser.sql`, reaplica-se esse arquivo: ele é idempotente (`DROP POLICY IF EXISTS`, `CREATE POLICY`, `ON CONFLICT DO NOTHING`). Em seguida roda de novo o verificador e o log guarda saída e exit code. Se o verify falhar, o deploy continua congelado.

Os grants novos (`USAGE` em `storage` e `SELECT` em `storage.buckets`) permanecem. A versão anterior do SQL não tem `REVOKE`, e eles só expõem o metadado do bucket. Desfazer de propósito, com autorização do Danilo:

```sql
revoke select on storage.buckets from backup_reader;
revoke usage on schema storage from backup_reader;
```

Depois disso o verify falha na leitura do bucket até o SQL atual ser aplicado de novo. Rodar o verify outra vez e registrar o exit code.

Primeiro deploy, sem versão anterior do SQL: não há o que reaplicar. Não restaurar o dump sem autorização do Danilo. Não dropar o bucket `tenant-files` enquanto houver objeto dentro. O verify roda mesmo assim, e o resultado vai para o log.
