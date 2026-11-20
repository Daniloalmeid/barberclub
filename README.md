# BarberClub

Monorepo da M1: esqueleto Next.js, schema Postgres 17 no Supabase local e as suítes T, G e C.

Não há tela de produto. O contrato HTTP desta etapa é `GET /api/health` e `GET /api/health/live`.

Os executáveis de backup e do Traefik ficam na VPS e não são copiados para cá. Os caminhos estão em `docs/artefatos-vps.md`.

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
supabase start
bash scripts/apply-superuser-grants.sh
supabase test db supabase/tests/pgtap
pnpm exec tsx supabase/tests/concurrency/run.ts
```
