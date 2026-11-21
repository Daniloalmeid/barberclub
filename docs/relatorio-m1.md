# Relatório da M1

A M1 fecha o monorepo, o schema e a suíte de banco. Não há tela de produto, deploy, Supabase na nuvem, DNS, Traefik nem segredo.

## O que entrou

- Monorepo pnpm com `apps/web` (Next.js, TypeScript, Tailwind) e os pacotes `config`, `core`, `db`, `payments` e `ui`. A página inicial só declara que esta build não tem produto. Os contratos HTTP são `GET /api/health` e `GET /api/health/live`.
- Middleware de entrada que responde 400 para path codificado, dot-segment e `;` no segmento, com teste unitário.
- Supabase local, Postgres 17, migrations em `supabase/migrations`.
- Papéis `ledger_owner` (NOLOGIN) e `backup_reader` (LOGIN, BYPASSRLS, só leitura, sem TEMP e sem CREATE). Schemas `public_api`, `server_api`, `private` e `ledger`. Default privileges restritivos para o `postgres` e para o `ledger_owner`.
- Tabelas com `tenant_id` e FKs compostas `(tenant_id, id)`. RLS com `USING` e `WITH CHECK` onde há escrita. `staff_busy` com uma origem só e `EXCLUDE gist`.
- Funções `SECURITY DEFINER` com `search_path` vazio. Advisory lock do profissional antes de qualquer row lock. Ledger de partidas dobradas, trigger de soma zero deferível, e bloqueio de `UPDATE`, `DELETE` e `TRUNCATE`.
- Catálogo público só pelas quatro funções de `public_api`, com colunas explícitas.
- CI em `.github/workflows/ci.yml`: lint, typecheck, teste unitário, build, Supabase do zero, grants de superusuário, pgTAP e concorrência.
- `ops/locks.yml` com a trava da M1 e os quatro caminhos canônicos da VPS.

## Contagem

| Suíte | Resultado |
|---|---|
| pgTAP (`supabase/tests/pgtap/m1_suite.sql`) | 132 asserções, T01–T26 e G01–G13, PASS |
| Concorrência C01–C08 | 20 rodadas cada, deadlocks do banco sem aumento, PASS |
| Unitário do path e do middleware | 43 testes, PASS |
| lint, typecheck e build do Next | PASS |

## Desvios

Estão justificados em `docs/decisoes-m1.md`. Os que mudam o desenho:

- `webhook_events.tenant_id` é `NOT NULL` e a FK composta `(tenant_id, payment_id)` é `DEFERRABLE INITIALLY DEFERRED`. O `INSERT` segue antes do advisory; a checagem fica no `COMMIT`. `refunds` e `refund_requests` usam a mesma composta, imediata, porque o `INSERT` já ocorre depois do advisory e do `FOR UPDATE`.
- Triggers de soma zero e de coerência do `staff_busy` são `SECURITY DEFINER`. No `COMMIT` eles rodam com o usuário da sessão, que não lê essas tabelas.
- `USAGE` em `auth` e as policies de `storage.objects` saem de `supabase/admin/superuser.sql`, aplicado pelo CI como `supabase_admin`. A migration, sozinha, não tem `GRANT OPTION`.
- T17 e G09 não varrem os schemas gerenciados do Supabase.
- Não há workflow de backup nem publicação no GHCR.

## Pendências da M2

- Projeto Supabase na nuvem, login, papéis na aplicação, convite e 2FA.
- Middleware de host completo (tenant pelo Host, path codificado já rejeitado).
- Ligar o backup diário no cron da VPS com o `backup_reader`, bucket R2 e heartbeat. O primeiro restore completo é critério de saída da M2.
- Confirmar, no projeto da nuvem, `BYPASSRLS` e `USAGE` em `auth` se o papel da migration de lá também não for superusuário.
- Fixar o digest da imagem Node antes de publicar no GHCR.
