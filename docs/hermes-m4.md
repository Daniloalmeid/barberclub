# M4: o que fica com o Hermes

A fonte é `docs/m4-arquitetura.md`, seções 2.6 e 12. Este arquivo não copia a regra do router: ela só vale no bloco YAML cru daquele documento.

| # | Item |
|---|---|
| H1 | Router e TLS no deploy. A regex usa barra simples dentro de aspas simples e crases. Antes de anunciar o domínio, `curl -H 'Host: xyz.barber.workloop.com.br'` tem de responder a aplicação, não a página do EasyPanel. |
| H2 | Migration do slug (3 a 32) em horário de pouco tráfego. `lock_timeout` de 2 s. `55P03`: nada foi gravado; rode de novo `scripts/apply-migrations.sh`. `23514`: rode o diagnóstico, corrija os slugs com autorização do Danilo e reaplique o mesmo arquivo. Não crie outra migration para repetir essa. |
| H3 | O mesmo diagnóstico como passo 1 da M2, com a contagem no log. Papel `backup_reader`, `PGOPTIONS='-c default_transaction_read_only=on'`, sem `--single-transaction`. |
| H4 | Rascunho de Termos e Privacidade. Não bloqueia a M4. |
| H5 | Checklist de 6 passos a cada tenant novo, até a fase 2. |
| H6 | No processo da imagem, antes do tráfego: `APP_ENV=production`, `ROOT_DOMAIN=barber.workloop.com.br`, `PUBLIC_SCHEME=https`, `PUBLIC_PORT` vazio, `HANDOFF_KEY`, `REVALIDATE_SECRET`, `BC_ROUTE_SECRET`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`. Sem `APP_ENV` com `NODE_ENV=production`, ou sem `ROOT_DOMAIN`, o processo não serve. |
| H7 | Na porta 80, antes de anunciar o domínio: `curl -sI --resolve xyz.barber.workloop.com.br:80:127.0.0.1 http://xyz.barber.workloop.com.br/`. O status é 308 e o `Location` começa com `https://`. O SNI entra pelo `--resolve`, não por um Host solto em `https://127.0.0.1`. |
| H8 | Rollback do router: reponha o arquivo dinâmico anterior do Traefik (a cópia feita antes da troca) e recarregue. Não apague certificado. O domínio só é anunciado depois do H7. |

O Danilo cria `contato@workloop.com.br` antes de a landing ir ao ar e autoriza a migration e o diagnóstico. A M4 não mexe em VPS, DNS, Traefik, Supabase Cloud nem tokens.
