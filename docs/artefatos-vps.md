# Artefatos canônicos na VPS

Estes arquivos já existem, foram testados e não têm segunda versão neste repositório. Qualquer mudança é um patch sobre o arquivo da VPS, aplicado pelo Hermes com autorização do Danilo.

| Caminho | Função |
|---|---|
| `/opt/workloop/barberclub/scripts/backup-daily.sh` | Backup diário. Roda no cron da VPS (D37, opção A), com `pg_dump` no container `postgres:17` e credenciais por `--env-file`. |
| `/opt/workloop/barberclub/scripts/traefik-drift-check.sh` | Detector de deriva do Traefik. |
| `/opt/workloop/barberclub/runbooks/traefik-window.md` | Runbook da janela da D25. |
| `/opt/workloop/barberclub/env/backup.env.example` | Modelo das variáveis do backup, sem segredo. |

Invariantes que nenhum patch pode quebrar: o dump usa a imagem `postgres:17` (o `pg_dump` 16.15 do host não fala com o servidor 17) e a senha entra por `--env-file`, nunca por `-e PGPASSWORD=` na linha de comando.

O papel do banco nesse cron é o `backup_reader`. Nunca o `postgres`. O backup não roda no GitHub Actions.
