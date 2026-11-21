# M4: o que fica com o Hermes

A fonte é `docs/m4-arquitetura.md`, seções 2.6 e 12. Este arquivo não copia a regra do router: ela só vale no bloco YAML cru daquele documento.

| # | Item |
|---|---|
| H1 | Router e TLS no deploy. A regex usa barra simples dentro de aspas simples e crases. Antes de anunciar o domínio, `curl -H 'Host: xyz.barber.workloop.com.br'` tem de responder a aplicação, não a página do EasyPanel. |
| H2 | Migration do slug (3 a 32) em horário de pouco tráfego. `lock_timeout` de 2 s. `55P03`: nada foi gravado; rode de novo `scripts/apply-migrations.sh`. `23514`: rode o diagnóstico, corrija os slugs com autorização do Danilo e reaplique o mesmo arquivo. Não crie outra migration para repetir essa. |
| H3 | O mesmo diagnóstico como passo 1 da M2, com a contagem no log. Papel `backup_reader`, `PGOPTIONS='-c default_transaction_read_only=on'`, sem `--single-transaction`. |
| H4 | Rascunho de Termos e Privacidade. Não bloqueia a M4. |
| H5 | Checklist de 6 passos a cada tenant novo, até a fase 2. |
| H6 | No processo da imagem, antes do tráfego: `APP_ENV=production`, `ROOT_DOMAIN=barber.workloop.com.br`, `PUBLIC_SCHEME=https`, `PUBLIC_PORT` vazio, `HANDOFF_KEY`, `REVALIDATE_SECRET`, `BC_ROUTE_SECRET` (mínimo de 32 caracteres), `CRON_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`. Sem `APP_ENV` com `NODE_ENV=production`, sem `ROOT_DOMAIN` ou com `BC_ROUTE_SECRET` curto, o processo não serve. |
| H7 | Na porta 80, antes de anunciar o domínio: `curl -sI --resolve xyz.barber.workloop.com.br:80:127.0.0.1 http://xyz.barber.workloop.com.br/`. O status é 308 e o `Location` começa com `https://`. O SNI entra pelo `--resolve`, não por um Host solto em `https://127.0.0.1`. |
| H8 | Rollback do router: reponha o arquivo dinâmico anterior do Traefik (a cópia feita antes da troca) e recarregue. Não apague certificado. O domínio só é anunciado depois do H7. |
| H9 | O limite de login usa o último valor de `X-Forwarded-For`. Vale com o Traefik em modo host, não no ingress do Swarm. `barber.workloop.com.br` e `*.barber.workloop.com.br` ficam em DNS only na Cloudflare: proxy laranja entrega o IP da Cloudflare e quebra o limite. Se o proxy for ligado, a leitura passa para `CF-Connecting-IP` com `trustedIPs` no Traefik. A porta 3000 do app não é publicada fora da rede do Traefik. Traefik 3.7.19, com a correção da CVE-2026-29054. O Hermes confirma esses quatro pontos no deploy. |

O Danilo cria `contato@workloop.com.br` antes de a landing ir ao ar e autoriza a migration e o diagnóstico. A M4 não mexe em VPS, DNS, Traefik, Supabase Cloud nem tokens.

O Hermes agenda, uma vez por dia, `POST https://barber.workloop.com.br/api/cron/handoffs` com o header `x-cron-secret` igual a `CRON_SECRET`. O agendamento é cron da VPS ou n8n. A aplicação não dispara sozinha. No `backup-daily.sh` da VPS, o `pg_dump` leva `--exclude-table-data=private.login_handoffs`. Este repositório não altera esse script.

Quem montar o n8n do revalidate chama `POST https://barber.workloop.com.br/api/internal/revalidate` no host base. Os headers são `x-revalidate-timestamp` e `x-revalidate-signature` (hex de HMAC-SHA256 de `REVALIDATE_SECRET` sobre `timestamp.corpo`). `X-BC-Timestamp` e `X-BC-Signature` não servem: o middleware descarta `x-bc-*`.

O `config.toml` do repositório só vale para o Supabase local. No GoTrue self-hosted de produção o Hermes liga o TOTP com `GOTRUE_MFA_TOTP_ENROLL_ENABLED=true` e `GOTRUE_MFA_TOTP_VERIFY_ENABLED=true`. Sem isso o dono não chega a AAL2.

## Adendo M4.1

A rede do Traefik no deploy é `easypanel`. Não é `easypanel-workloop`.

Uma regra mista `Host(...) || HostRegexp(...)` pode não emitir certificado. O padrão é um router por host explícito, `barber.workloop.com.br` e `www.barber.workloop.com.br`, cada um com `certResolver`, e um router `HostRegexp` separado, de prioridade menor, só encaminhando. A regex é `^.+[.]barber[.]workloop[.]com[.]br$`: o ponto entra como classe, o que evita o problema de escape da barra no YAML.

`docker service update` não aceita `--env-file`. Só `--env-add`. O deploy sincroniza todas as chaves do arquivo de ambiente, uma a uma, com `--env-add`. Não passa o arquivo no comando e não deixa chave do arquivo de fora.
