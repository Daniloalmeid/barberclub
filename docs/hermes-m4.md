# M4: o que fica com o Hermes

A fonte é `docs/m4-arquitetura.md`, seções 2.6 e 12. Este arquivo não copia a regra do router: ela só vale no bloco YAML cru daquele documento.

| # | Item |
|---|---|
| H1 | Router e TLS no deploy. A regex usa barra simples dentro de aspas simples e crases. Antes de anunciar o domínio, `curl -H 'Host: xyz.barber.workloop.com.br'` tem de responder a aplicação, não a página do EasyPanel. |
| H2 | Migration do slug (3 a 32) em horário de pouco tráfego, com `lock_timeout`. A query read-only está em `scripts/diagnose-tenant-slugs.sql`. |
| H3 | O mesmo diagnóstico como passo 1 da M2, com a contagem no log. |
| H4 | Rascunho de Termos e Privacidade. Não bloqueia a M4. |
| H5 | Checklist de 6 passos a cada tenant novo, até a fase 2. |

O Danilo cria `contato@workloop.com.br` antes de a landing ir ao ar e autoriza a migration e o diagnóstico. A M4 não mexe em VPS, DNS, Traefik, Supabase Cloud nem tokens.
