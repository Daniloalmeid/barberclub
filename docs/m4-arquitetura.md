# BarberClub M4: tenant por Host, host base (landing mínima e /login) e SEO canônico (v1.3)

Status: **desenho, sem implementação**. Nada daqui foi aplicado no repositório: sem edição, commit, branch ou PR.
Data: 21/11/2026 (horário de Brasília, UTC-3). Autor: arquiteto técnico (Grok Bot), a pedido do Orquestrador.
Versão: **v1.3**. Base: `m4-arquitetura-tenant-host-v1.2.md` (md5 `dd5a17185bdaf573f3fe4a178567de9a`, mantida intacta). v1.1 e v1.0 também intactas.

## Mudanças da v1.3

Fonte: `/workspace/barberclub/resposta-hermes-m4-v1.2.md`, do Danilo via Hermes, lido inteiro. A v1.2 foi aprovada, com três ajustes antes de fechar.

| Item | Mudança | Onde |
|---|---|---|
| Regex | Conferido no `.md` cru: as duas regras do router (§2.6, linhas `rule:` do YAML) usam **barra simples** (`\.`) dentro de string YAML com aspas simples e crases, o que está correto. O `\\.` que o Hermes viu é escape vazado numa versão renderizada ou copiada. Entraram (i) a nota explícita sobre o escape no YAML, (ii) o passo de validação do Hermes com `curl -H 'Host: xyz.barber.workloop.com.br'` antes de anunciar o domínio e (iii) a §1 alinhada com a §2.6, que tinha o regex antigo `[a-z0-9-]+` e "catch-all de outras aplicações". As linhas-resumo da tabela que copiavam a regra com `\|` de tabela markdown agora remetem à §2.6. A regra fica **só** no bloco YAML. | §1.3, §2.6, Mudanças da v1.2, §11 |
| R12 | Passa a "aceito na fase 1 **até o 4º tenant**". Regra do Danilo: quando o 4º tenant for criado, a fase 2 é **agendada antes do onboarding do 5º**. O histórico dos CT logs não se apaga. Isso **fecha o O11**. | §2.6, §11 |
| Fase 2 | Registrado o desenho técnico do Hermes (item 3 do arquivo): token Cloudflare Zone:DNS:Edit em arquivo 600 lido por `_FILE`, resolver `cfdns` separado do `letsencrypt` HTTP-01, `tls.domains` com `main` e SAN wildcard, e primeira emissão validada no `acme.json` e no log do lego. | §2.6 |
| Traefik | A VPS está na **3.7.19** desde 21/11, com backup do `acme.json` e detector de deriva em timer diário. As menções a 3.6.7 e à janela pendente foram atualizadas. | §1.3, §2.6, §11 |
| P7 | **Decidida:** o Danilo cria `contato@workloop.com.br` via Cloudflare Email Routing (encaminhando para o Yahoo provisório) **antes** de a landing ir ao ar. Até lá, o e-mail provisório continua oficial. Não bloqueia a M4. | §4.1, §4.7, §11 |
| Onboarding | O checklist de onboarding manual de tenant, com os 6 passos **exatos** do item 5 do arquivo, passa a ser obrigatório na §2.6. Ele está ligado ao O10 e ao R13. | §2.6, §11 |
| Fechamento | Nova seção §12 com o que fica com o Hermes. | §12 |
| Outros | A v1.2 está aprovada pelo Hermes, incluindo a regra de **nunca remover o Host** de um tenant do router, nem quando ele fica inativo ou troca de slug. Isso fica mantido. A observação "a primeira emissão é o teste, não a documentação" (nomes de variáveis do lego mudaram entre v4 e v5) também entrou. | §2.6 |

## Mudanças da v1.2

Fonte: a resposta do Danilo e do Hermes à v1.1, conforme o pedido do Orquestrador.

> **Aviso de fonte (texto alinhado na v1.3).** O arquivo de anexo indicado originalmente não existia no box quando a v1.2 foi escrita. Depois disso, os três links wa.me e o e-mail provisório foram copiados literalmente de `/workspace/barberclub/resposta-hermes-m4-v1.1.md` (P6 fechada). Esse arquivo não traz pontos além dos 8 incorporados.

| Item | Mudança | Onde |
|---|---|---|
| P1, P2, P4 | **Fechadas.** Os botões "Quero testar", "Falar com o suporte" e "Regularizar" apontam para os **links wa.me do arquivo**, que são constantes. Não há rota nova nem formulário. O e-mail de contato provisório também vem do arquivo. A troca para `contato@workloop.com.br` via Cloudflare Email Routing é recomendação e fica como **pendência do Danilo (P7)**, sem DNS na M4. Na **M6**, "Regularizar" passa a apontar para a fatura, com URL montada no servidor. | §4.1, §4.6, §4.7 |
| P3 | O rascunho de Termos e Privacidade fica com o **Hermes** e **não bloqueia** a M4. | §4.1, §11 |
| P5 | O diagnóstico de slug vira o **primeiro passo da M2**, com a contagem registrada no log. Não é bloqueio. | §2.3, §11 |
| E1 | O catch-all de hoje é a página de erro do EasyPanel, com certificado autoassinado. Fica documentado o router do Traefik v3 (`Host` do host base **ou** `HostRegexp` de `*.barber.workloop.com.br`) com `priority: 100`, configurado pelo **Hermes** no deploy. **A regra literal fica só no bloco YAML da §2.6** (v1.3). | §2.6 |
| E2 | **Duas fases.** **Fase 1:** HTTP-01 com Host explícito por tenant. O 404 idêntico vale **só para hosts roteados**; hosts não roteados caem no catch-all com erro de TLS. O risco de enumeração por CT logs fica documentado. **Fase 2:** DNS-01 com wildcard e 404 neutro em toda a árvore. A promessa da D7 e os testes foram ajustados e marcados como F1 ou F2. | D7, §2.6, §5, §10.5, §11 |
| R5 | **Sai dos riscos.** O Hermes mediu que o middleware lê `process.env` em runtime. Fica só o curl de confirmação em staging. | §10.5, §11 |
| O4 | **Decidido:** a troca de slug é **só pelo superadmin**, e o slug antigo fica **bloqueado para sempre** no histórico. | §6.4, §11 |
| O5 | **Decidido:** o "Sair" usa `signOut({ scope: "local" })`. "Sair de todos os dispositivos" (`global`) fica para depois. | §4.4, §4.6, §11 |
| O6 | **Decidido:** a recuperação de senha entra na **M5**. Nessa hora `/recuperar` e `/auth/confirm` entram na allowlist do host base. Na M4 os dois dão 404 neutro. | §3.2, §11 |
| has_role | O `grant execute on function private.has_role(uuid, text[]) to authenticated` **já existe** (verificado pelo Hermes, e consta em `20261120107000_rls_grants.sql`). A v1.2 não cria grant novo para ele. | §4.6 |

## Mudanças da v1.1

As decisões abaixo são do Danilo sobre a seção 11 da v1.0.

| Item | Decisão | Onde |
|---|---|---|
| (a) | `/{slug}` no host base dá **404 neutro, sem 301**. Isso fica **decidido** e substitui o redirect da v1.8. | §3.2, §11 |
| (b) | Entra uma migration que exige slug com 3 a 32 caracteres. Antes de mudar a constraint ela **conta** os slugs fora da regra. Se houver algum, ela falha com `RAISE EXCEPTION` informando **só a contagem**. Não renomeia nem apaga nada. A v1.1 traz também uma query de diagnóstico read-only. | §2.3, §10.4 |
| (c) | O login leva ao **subdomínio do tenant**. `app.` e `admin.` continuam 404 neutro na M4. | §2.5, §4, §11 |
| (d) | O dono de tenant `past_due` ou `suspended` vê uma **tela de regularização** em `/login/regularizar`, no host base, autenticada. O subdomínio do tenant inativo continua com o 404 idêntico para todos, inclusive para o dono. Staff que não é owner continua vendo "nenhum tenant". O destino de pagamento fica como **PENDÊNCIA P4**. | §4.2, §4.6, §10.4, §11 |
| - | Na allowlist do host base entra `/login/regularizar`. Nenhuma outra rota nova. | §3.1, §3.2, D5 |


---

## 0. Resumo das decisões

| # | Decisão |
|---|---|
| D1 | O tenant sai **só do header `Host`**. `X-Forwarded-Host`, `Forwarded` e `X-Forwarded-Proto` são ignorados para rotear e para montar URL, porque na VPS o Traefik roda com `forwardedHeaders.insecure=true` (fato medido no Doc. Técnico v1.8). |
| D2 | Slug com **3 a 32** caracteres: `^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`, sem `--` em nenhuma posição (isso cobre `xn--`). É a regra da v1.8. A constraint atual do banco aceita 1 caractere, e a M4 corrige isso. |
| D3 | Host **malformado ou ausente** dá **400** `{"error":"bad_host"}`. Host **bem formado mas não servido** (IP, outro domínio, mais de um nível, slug inválido ou reservado, `app.`/`admin.` ainda não implementados) dá **404 neutro**. `www.` e o ponto final (FQDN) dão **308** para o host canônico, montado só com constantes. Maiúsculas viram minúsculas sem redirect. A porta é ignorada. |
| D4 | Slugs reservados: a fonte é `packages/config` (a lista `reservedSlugs` que já existe, ampliada). O espelho no banco é `public.reserved_slugs` + prefixos + trigger em `public.tenants`, e o formato também fica como `CHECK`. Um teste de CI compara as duas listas. |
| D5 | O **host base é uma landing mínima, estática, sem banco e sem resolução de tenant**. Rotas: `/`, `/login`, `/login/regularizar` (v1.1), `/termos`, `/privacidade`, `/robots.txt` e `/sitemap.xml`. Qualquer outro path dá 404 neutro, inclusive `/{slug}` (**decidido na v1.1**, sem 301, substituindo o redirect da v1.8). |
| D6 | Roteamento por **rewrite** no middleware para dois prefixos internos: `/landing/*` (host base) e `/tenant/[tenant]/*` (subdomínio). Os prefixos acessados de fora dão 404. Rota de tenant nunca responde no host base, e vice-versa. |
| D7 | **404 idêntico** para tenant inexistente, inativo (`past_due`/`suspended`), slug inválido ou reservado e host desconhecido: um único `app/not-found.tsx` neutro, mesmos headers, `noindex`. **Escopo por fase (v1.2):** na **fase 1** (HTTP-01), a garantia vale só para os **hosts roteados** pelo Traefik, que têm certificado próprio. Um host não roteado cai no catch-all com erro de TLS e não chega à aplicação (§2.6). Na **fase 2** (DNS-01 com wildcard), a garantia vale para toda a árvore `*.barber.workloop.com.br`. Inexistente e inativo seguem o mesmo caminho de código: um RPC que já filtra `status in ('trial','active')`. |
| D8 | Leitura pública **só** por `public_api.get_tenant_public(p_slug)` (já existe, com colunas explícitas), com `select=` explícito e a chave publicável. Cache positivo de 300 s com tag `tenant:{slug}`. Cache negativo de 30 s. Invalidação por `revalidateTag` na escrita, mais uma rota interna com HMAC como backstop. Falha do banco dá 503, nunca 404 cacheado. |
| D9 | Na troca de slug, o **antigo vira 404, sem redirect**, e não pode ser reusado por outro tenant (histórico). |
| D10 | `/login` (Supabase Auth, com 2FA para owner conforme a v1.8): **1 tenant** → redirect direto; **vários** → escolha no próprio `/login`, só com os tenants do usuário; **nenhum** → mensagem neutra, sem redirect. **Owner de tenant `past_due`/`suspended`** → tela de regularização (D14). O destino é montado no servidor com slug revalidado e allowlist de host. `next` só aceita path relativo validado. |
| D11 | **Cookie de sessão host-only** (sem `Domain`). A sessão **muda** do host base para o subdomínio por um handoff de uso único (60 s), e o host base apaga a própria sessão depois. Nunca há cookie em `.barber.workloop.com.br`. |
| D12 | Canonical absoluto e sem barra final (a raiz é `/`). `sitemap.xml` e `robots.txt` por host. Fora de produção: `Disallow: /` e `X-Robots-Tag: noindex` em tudo. |
| D13 | Ordem do middleware: **1)** recusa de path (400, M1) → **2)** canonicalização de path e host (308, um salto só) → **3)** host base (rewrite para a landing, sem banco) **ou** tenant (rewrite para `/tenant/{slug}`) **ou** 404 neutro. |
| D14 | **Regularização (v1.1):** `/login/regularizar` fica no host base, exige sessão e mostra só slug, nome, status e a ação de regularização dos tenants em que o usuário é **owner**. A leitura vem de `private.owner_regularization_rows()` (`SECURITY DEFINER`, com `has_role` owner), exposta por `public_api.my_regularization_tenants()`. O subdomínio inativo continua 404 idêntico para todos. |
| D15 | **Migration de slug (v1.1):** roda numa transação com `lock_timeout` e `ACCESS EXCLUSIVE` em `tenants`. Conta os slugs fora da regra e, se houver algum, `RAISE EXCEPTION` só com a contagem. Depois troca a constraint num único `ALTER TABLE`, validado na hora. |
| D16 | **Links externos (v1.2):** os botões "Quero testar", "Falar com o suporte" e "Regularizar" usam os links wa.me literais do arquivo do Danilo e do Hermes, como constantes em `packages/config`, com `target="_blank" rel="noopener noreferrer"`. Não há rota nova nem formulário. Na M6, "Regularizar" passa a apontar para a fatura, com URL montada no servidor. |
| D17 | **Borda em duas fases (v1.2):** na **fase 1**, HTTP-01 com Host explícito por tenant, mais o router `HostRegexp` com priority 100. Na **fase 2**, DNS-01 com wildcard. Configuração a cargo do Hermes (§2.6). |
| ~~P1/P2/P4~~ | **Fechadas na v1.2** (D16), com os links e o e-mail literais do arquivo (P6 fechada). |
| D18 | **Fase 2 com gatilho (v1.3):** R12 aceito na fase 1 **até o 4º tenant**. A criação do 4º tenant agenda a fase 2 (DNS-01 wildcard, resolver `cfdns`), que tem de entrar antes do onboarding do 5º. Desenho técnico do Hermes na §2.6. Traefik já na 3.7.19. |
| D19 | **Onboarding manual de tenant (v1.3):** checklist obrigatório de 6 passos na §2.6, com verificação de TLS e de conteúdo antes de avisar o cliente. |
| D20 | **E-mail de contato (v1.3, P7):** `contato@workloop.com.br` via Cloudflare Email Routing, criado pelo Danilo antes de a landing ir ao ar. Até lá, o provisório é o oficial. |

---

## 1. Fontes lidas e suposições

### 1.1 Repositório (somente leitura, conector GitHub, `main`)

**Lidos por completo:**
- `docs/requisitos-m4.md`, `docs/decisoes-m1.md`
- `apps/web/src/middleware.ts`, `apps/web/src/path-guard.ts`, `apps/web/src/middleware.test.ts`
- `apps/web/next.config.ts`, `apps/web/package.json`
- `apps/web/src/app/page.tsx`, `apps/web/src/app/api/health/route.ts`
- `packages/config/src/index.ts`, `.env.example`
- `scripts/check-path-http.mjs`, `scripts/check-path-http.sh`
- `.github/workflows/ci.yml`, `ops/locks.yml`
- as migrations `20261120100000_roles_schemas_privileges.sql`, `20261120101000_tables.sql` e `20261120107000_rls_grants.sql`
- a árvore completa do repositório

**Lidos em parte:**
- `20261120105000_public_api.sql`: a lista de funções e o `get_tenant_public`, `list_services` e `list_staff` completos
- `20261120103000_private_functions.sql`: o `has_role` e a lista de funções
- `supabase/config.toml`: o trecho `[api] schemas`

**Não lidos:**
- as migrations `server_api`, `ledger*` e `webhook*`
- `supabase/tests/pgtap/m1_suite.sql`, `Dockerfile`, `app/layout.tsx`
- `infra/runbooks/deploy-supabase-admin.md`, os demais `packages/*`

### 1.2 Docs locais (só as partes de tenant, host, middleware, `public_api` e slug)

- `BarberClub-Documento-Tecnico-Etapa0-v1.8.md`: §2, a tabela de hosts, slugs, reservados e path codificado; a árvore do repositório; a autenticação; a §9.1 sobre IP e forwarded headers; as variáveis de ambiente da §12.3; o staging da §12.7; a tabela da `public_api`.
- `resposta-hermes-condicoes-m1.md`, `resposta-hermes-m1-entregue.md`: "o middleware de host completo fica para a M2/M4"; o deploy é responsabilidade do Hermes.

### 1.3 Fatos usados

**Banco:**
- `public.tenants.slug text not null unique`. A constraint `tenants_slug_shape` é `^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$` + `!~ '--'` + `!~ '^xn--'`. Ela aceita 1 caractere ou de 3 a 32 (nunca 2) e diverge da v1.8, que exige 3 a 32.
- `tenants.status` admite `trial`, `active`, `past_due` e `suspended`.
- `public_api.get_tenant_public(p_slug)` devolve exatamente as colunas `slug, display_name, logo_url, banner_urls, color_primary, color_secondary, color_accent, address_line, city, state, phone_public, whatsapp_public, instagram_handle, timezone, opening_hours, booking_policy_text`. Ela é `security definer`, filtra `status in ('trial','active')` e tem `EXECUTE` para `anon` e `authenticated`.
- `memberships(tenant_id, user_id, role owner|manager|staff, status active|invited|revoked)` e `private.has_role` existem. **Não** existe função que liste os tenants do usuário.
- `public_api` está exposto no PostgREST. `anon` não tem grant em tabelas de `public`.

**App:**
- O `apps/web` não depende de `@supabase/supabase-js` nem de `@supabase/ssr`. O health usa `fetch` cru com `accept-profile`.
- `next.config.ts`: `output: "standalone"`, `skipMiddlewareUrlNormalize`, `skipTrailingSlashRedirect`. O matcher do middleware é `/:path*`.
- Pastas vazias da M1: `(cliente)/[tenant]`, `(painel)/painel/[tenant]`, `(site)`, `(superadmin)/admin`. Como grupos `( )` não entram na URL, `(cliente)/[tenant]` casaria com `/{qualquer}` no host base. A M4 reorganiza (§3).
- `packages/config/src/index.ts` já tem a lista de reservados da v1.8, com 65 itens (`app`, `admin`, `api`, `www`, ...).
- O `check-path-http.mjs` usa `Host: slug.barber.workloop.com.br` e espera `/` → 200. Na M4 esse Host vira tenant sem fixture, e o caso muda de Host (§10.3, R7).

**Infra e produto (v1.8):**
- Infra: VPS com EasyPanel e Traefik. Supabase Cloud em São Paulo. Staging em `barber-staging.workloop.com.br` e `*.barber-staging.workloop.com.br`. `ROOT_DOMAIN` vem do EasyPanel.
- **Router (alinhado com a §2.6 na v1.3).** A regra de produção é a do bloco YAML da §2.6, com `HostRegexp` `^.+\.barber\.workloop\.com\.br$` e `priority: 100`. Ela substitui o `[a-z0-9-]+` da v1.8. O catch-all `HostRegexp('.+')` do `main.yaml` é a **página de erro do EasyPanel**, com certificado autoassinado (E1). Hosts de mais de um nível (`a.b.barber…`) **chegam** à aplicação e recebem 404 neutro.
- **Traefik 3.7.19** desde 21/11 (Hermes), com backup do `acme.json` e detector de deriva em timer diário. A CVE-2026-29054 (afeta abaixo da 3.6.9) não se aplica mais. A v1.8 mediu `forwardedHeaders.insecure=true` nos entrypoints, e o arquivo do Hermes não diz se isso mudou na janela. A M4 continua tratando `X-Forwarded-*` como controlável pelo cliente.
- Hosts especiais da v1.8: `app.barber...` é o PWA do barbeiro e `admin.barber...` é o superadmin com 2FA. Os dois são slugs reservados.
- Autenticação: Supabase Auth, OTP ou senha, **2FA obrigatório para owner e superadmin**, cookies httpOnly, `getUser()` no servidor.

### 1.4 Suposições (não verificadas)

- **S1:** produção roda **uma réplica** do container web. Isso afeta o cache e o `revalidateTag` (R1).
- **S2:** o método de login exato (senha ou OTP) é da M2. O desenho funciona com os dois.
- **S3:** a v1.8 colocava "planos e onboarding" no host base. A decisão nova do Danilo (landing mínima) **substitui** isso, e o onboarding fica atrás da PENDÊNCIA P1.

---

## 2. Resolução de tenant pelo Host

### 2.1 Fonte do host e anti-spoof

- A fonte única é `request.headers.get("host")`. **Não** usar `x-forwarded-host`, `forwarded` nem `request.nextUrl.host`/`origin` para rotear ou montar URL.
- Motivo: com `forwardedHeaders.insecure=true`, o cliente controla `X-Forwarded-*`. O Host da linha HTTP é o que o Traefik usou para casar o router, então é o único coerente com a borda.
- O esquema e a porta públicos vêm de configuração (`PUBLIC_SCHEME`, `PUBLIC_PORT`), nunca de `x-forwarded-proto`/`port`.
- Política para proxy: o Traefik deve repassar o Host original (`passHostHeader`, o padrão). Se um dia entrar CDN ou outro proxy, ele também precisa preservar o Host. A aplicação **nunca** passa a ler XFH. A correção de `forwardedHeaders` (D26 da v1.8) não muda esta regra.
- Vercel não está em uso. Se um dia houver, a regra continua sendo "Host e config". Não existe um modo "confiar no XFH".

### 2.2 Ambientes (validados no boot, fail-closed)

| Variável | Produção | Staging | Dev local | CI (`next start`) |
|---|---|---|---|---|
| `APP_ENV` | `production` | `staging` | `development` | `test` |
| `ROOT_DOMAIN` | `barber.workloop.com.br` (exigido literal) | `barber-staging.workloop.com.br` | `localhost` | `barber.workloop.com.br` |
| `PUBLIC_SCHEME` | `https` (exigido) | `https` | `http` | `https` |
| `PUBLIC_PORT` | vazio (exigido) | vazio | `3000` | vazio |

- **Dev:** `localhost:3000` é o host base e `minha-barbearia.localhost:3000` é tenant. Chrome e Firefox resolvem `*.localhost` para loopback, sem `/etc/hosts`.
- **Staging:** o mesmo parser, com outro `ROOT_DOMAIN`. Leva sempre `noindex` e `Disallow: /`.
- **Não existe** override de tenant por query, cookie ou header (`?tenant=`, `x-tenant`, `DEV_TENANT`) em nenhum ambiente. Esse atalho acaba ligado em produção.
- **`*.vercel.app` e preview efêmero: não suportados.** Se surgirem, entram como `APP_ENV=preview` com um `ROOT_DOMAIN` próprio, sem regra especial no parser.
- `loadConfig()` lança erro no boot se `APP_ENV=production` e `ROOT_DOMAIN`, `PUBLIC_SCHEME` ou `PUBLIC_PORT` fugirem do esperado. Também lança se `ROOT_DOMAIN` não passar no próprio parser.

### 2.3 Regex do slug

```ts
// packages/config/src/slug.ts
export const SLUG_MIN = 3;
export const SLUG_MAX = 32;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
export const isSlugShape = (s: string) => SLUG_RE.test(s) && !s.includes("--");
```

Justificativa:
- **Mínimo de 3.** Segue a v1.8. 1 ou 2 caracteres viram squatting barato e colidem com rótulos técnicos (`mx`, `ns`, `sw`, `ws`).
- **Máximo de 32.** Fica bem abaixo dos 63 por label DNS e cabe em chave de cache e nome de cookie. É legível em URL e WhatsApp.
- **Sem hífen nas pontas.** É regra de hostname (RFC 1123).
- **Sem `--` em qualquer posição.** Bloqueia `xn--` (punycode e homógrafos IDN) e qualquer label no formato `??--` (posições 3 e 4) que o DNS reserva. É mais restritivo que bloquear só as posições 3 e 4, e é mais simples.
- **Só ASCII minúsculo.** O Host passa por `toLowerCase()`. Unicode no Host dá 400 antes da regex.

Migration da M4, alinhando o banco com a v1.8 (decisão (b) da v1.1). Nome sugerido: `supabase/migrations/2026112xxxxxxx_tenant_slug_min3.sql`.

**Diagnóstico read-only, para rodar antes.** **Na v1.2, este é o primeiro passo da M2.** O Hermes roda, com autorização do Danilo, em staging e em produção, e registra a contagem no log de deploy (`/var/log/barberclub/`). Não é bloqueio: se a contagem for maior que 0, a migration falha sozinha, e a correção fica para decisão do Danilo. A query não altera nada:

```sql
begin transaction read only;
select count(*)                                                   as total,
       count(*) filter (where length(slug) < 3)                   as curtos,
       count(*) filter (where length(slug) > 32)                  as longos,
       count(*) filter (where position('--' in slug) > 0)         as hifen_duplo,
       count(*) filter (where not (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
                                   and position('--' in slug) = 0)) as fora_da_regra
  from public.tenants;
rollback;
```

A constraint atual só deixa passar slug de 1 caractere fora da regra nova. Por isso `curtos` é o número que importa, e `longos` e `hifen_duplo` devem dar 0. A query devolve só contagens. Se for preciso ver quais slugs são, a listagem é uma consulta separada, feita pelo Hermes com autorização explícita do Danilo, e não entra em log de CI.

**Migration.** O `scripts/apply-migrations.sh` aplica cada arquivo com `--single-transaction`. O bloco inteiro é atômico: se a exceção for levantada, nada muda.

```sql
-- Reversão: alter table public.tenants drop constraint tenants_slug_shape,
--   add constraint tenants_slug_shape check (slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$'
--   and slug !~ '--' and slug !~ '^xn--');
set local lock_timeout = '5s';          -- não fica na fila atrás de transação longa; falha e tenta de novo
set local statement_timeout = '60s';

-- Trava antes de contar: entre a contagem e a constraint ninguém insere nem renomeia slug.
lock table public.tenants in access exclusive mode;

do $$
declare
  v_fora bigint;
begin
  select count(*) into v_fora
    from public.tenants
   where not (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' and position('--' in slug) = 0);
  if v_fora > 0 then
    -- Só a contagem: nenhum slug no texto do erro (ele vai para log de CI e de deploy).
    raise exception 'tenants_slug_shape: % slug(s) fora da regra de 3 a 32 caracteres; migration abortada sem alterar dados', v_fora
      using errcode = '23514',
            hint = 'Rode a query de diagnóstico read-only do doc M4 §2.3; corrija os slugs com autorização do Danilo e reaplique.';
  end if;
end
$$;

-- Troca atômica num único ALTER TABLE, validado na hora.
alter table public.tenants
  drop constraint tenants_slug_shape,
  add constraint tenants_slug_shape check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
    and position('--' in slug) = 0
  );
```

Por que sem `NOT VALID` / `VALIDATE`:
- **Não haveria ganho.** `NOT VALID` seguido de `VALIDATE` só reduz o tempo de lock quando os dois passos rodam em **transações diferentes**. Aqui a migration já roda numa transação só e já segura `ACCESS EXCLUSIVE` em `tenants`, que tem poucas linhas (uma por barbearia). Validar na hora custa milissegundos.
- **Combina com a regra da M1.** Fazer em duas migrations deixaria um estado intermediário com constraint `NOT VALID`, e a regra da M1 é migration atômica, sem estado parcial.
- **O lock e o `lock_timeout`** garantem que a contagem e a constraint enxergam os mesmos dados. Também evitam que a migration fique esperando atrás de uma transação longa e bloqueie leituras: depois de 5 s ela falha, e o deploy é refeito.
- **Nenhum `UPDATE` ou `DELETE`:** a migration não renomeia nem apaga.
- **O 23514 também vale para o CI.** O `apply-migrations.sh` sai com erro e não grava a versão em `schema_migrations`, porque a transação é revertida.

### 2.4 Parser de host (puro, sem I/O)

```ts
// packages/core/src/host.ts
import { isSlugShape } from "@barberclub/config/slug";
import { isReservedSlug } from "@barberclub/config/reserved";

export type HostClass =
  | { kind: "bad" }                               // 400 bad_host
  | { kind: "base" }                              // landing + /login
  | { kind: "redirect"; host: string }            // 308 para host canônico
  | { kind: "special"; name: "app" | "admin" }    // hosts da v1.8; 404 neutro na M4
  | { kind: "tenant"; slug: string }              // rewrite /tenant/{slug}
  | { kind: "unknown" };                          // 404 neutro

const HOST_CHARS = /^[a-z0-9.\-:\[\]]+$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6 = /^\[[0-9a-f:.]+\](?::(\d{1,5}))?$/;
const NAME_PORT = /^([^:\[\]]+)(?::(\d{1,5}))?$/;
const SPECIAL = new Set(["app", "admin"]);

export function classifyHost(raw: string | null, root: string): HostClass {
  if (raw == null || raw === "" || raw.length > 255) return { kind: "bad" };
  const h = raw.toLowerCase();
  if (!HOST_CHARS.test(h)) return { kind: "bad" };            // espaço, _, @, /, %, unicode
  if (h.startsWith("[")) {
    const m = h.match(IPV6);
    return !m || (m[1] && !validPort(m[1])) ? { kind: "bad" } : { kind: "unknown" };
  }
  const m = h.match(NAME_PORT);
  if (!m || (m[2] !== undefined && !validPort(m[2]))) return { kind: "bad" };
  let name = m[1]!;
  const dot = name.endsWith(".");
  if (dot) name = name.slice(0, -1);
  if (!name || name.split(".").some((l) => l.length === 0 || l.length > 63)) return { kind: "bad" };
  if (IPV4.test(name)) return { kind: "unknown" };

  if (name === root) return dot ? { kind: "redirect", host: root } : { kind: "base" };
  if (name === `www.${root}`) return { kind: "redirect", host: root };
  if (!name.endsWith(`.${root}`)) return { kind: "unknown" };
  const label = name.slice(0, -(root.length + 1));
  if (label.includes(".")) return { kind: "unknown" };            // a.b.barber...
  if (SPECIAL.has(label)) return dot ? { kind: "redirect", host: name } : { kind: "special", name: label as "app" | "admin" };
  if (!isSlugShape(label) || isReservedSlug(label)) return { kind: "unknown" };
  return dot ? { kind: "redirect", host: name } : { kind: "tenant", slug: label };
}
const validPort = (p: string) => { const n = Number(p); return Number.isInteger(n) && n >= 1 && n <= 65535; };
```

### 2.5 Decisão por caso

| Host recebido | Classe | Resposta |
|---|---|---|
| ausente ou vazio | bad | 400 `{"error":"bad_host"}`, `no-store`. O Node pode recusar antes, também com 400. |
| com espaço, `_`, `@`, `%`, `/` ou unicode | bad | 400 `bad_host` |
| porta inválida (`:`, `:0`, `:70000`, `:abc`, `a:b:c`) | bad | 400 `bad_host` |
| label vazio (`a..b`, `.barber...`) ou label com mais de 63 caracteres | bad | 400 `bad_host` |
| `barber.workloop.com.br`, em qualquer caixa e com qualquer porta | base | landing ou `/login` (rewrite) |
| `barber.workloop.com.br.` | redirect | 308 `https://barber.workloop.com.br{path}{query}` |
| `www.barber.workloop.com.br`, com ou sem `.` final | redirect | 308 `https://barber.workloop.com.br{path}{query}` |
| `abc.barber.workloop.com.br`, `ABC.…`, `abc.…:3000` | tenant `abc` | rewrite. O banco decide entre página e 404 neutro. |
| `abc.barber.workloop.com.br.` | redirect | 308 `https://abc.barber.workloop.com.br{path}{query}` |
| `app.…`, `admin.…` | special | 404 neutro na M4 (**decidido na v1.1**). Entram nas milestones próprias. |
| `a.b.barber…`, `www.abc.barber…` | unknown | 404 neutro |
| `ab.…`, `-ab.…`, `ab-.…`, `a--b.…`, `xn--ab.…`, label de 33 ou mais | unknown | 404 neutro, sem banco |
| reservado (`api.…`, `painel.…`, `cdn-01.…`) | unknown | 404 neutro, sem banco |
| `127.0.0.1`, `10.0.0.5:3000`, `[::1]` | unknown | 404 neutro. Exceção: `/api/health*` responde em qualquer host (§3.2). |
| `evil.com`, `barber.workloop.com.br.evil.com`, `xbarber.workloop.com.br`, `workloop.com.br` | unknown | 404 neutro |
| `barber-staging.workloop.com.br` com o `ROOT_DOMAIN` de produção | unknown | 404 neutro |

- **Por que 400 contra 404.** 400 é só para sintaxe de Host inválida, que é erro de protocolo. Tudo o que é bem formado mas não servido recebe o mesmo 404 do tenant inexistente. Não existe sinal que separe "inválido", "reservado", "não existe" e "inativo".
- **Maiúsculas não redirecionam.** DNS e Host não diferenciam caixa, e os navegadores já enviam minúsculo. O canonical resolve a parte de SEO.
- **Porta não redireciona.** Em produção, o Traefik termina o TLS em :443. A porta é descartada, e o canonical nunca leva porta.
- **O 308 de host não reaproveita o Host recebido.** O destino é montado com `PUBLIC_SCHEME`, o `ROOT_DOMAIN` validado e o label já aprovado no parser, mais o path e a query já canonicalizados (§8).

### 2.6 Borda: router do Traefik e fases de certificado (v1.2, revisada na v1.3)

**Versão do Traefik (v1.3):** a VPS está na **3.7.19** desde 21/11/2026, com backup do `acme.json` e detector de deriva em timer diário (Hermes). A sintaxe abaixo é a do Traefik v3.

**Situação medida pelo Hermes (E1).** O catch-all de hoje (`HostRegexp('.+')` no `main.yaml`) responde com a página de erro do EasyPanel e um certificado autoassinado. Sem um router do BarberClub com prioridade maior, um host `*.barber…` que não casa cai nesse catch-all.

**Router da aplicação.** Traefik v3, provider de arquivo. O Hermes aplica no deploy, sem declarar o mesmo host na aba Domains do EasyPanel (regra fixa da v1.8 §12.7):

```yaml
http:
  routers:
    barberclub-web-http:
      entryPoints: [http]
      rule: 'Host(`barber.workloop.com.br`) || HostRegexp(`^.+\.barber\.workloop\.com\.br$`)'
      priority: 100
      middlewares: [redirect-to-https]      # já definido no main.yaml
      service: barberclub-web
    barberclub-web-https:
      entryPoints: [https]
      rule: 'Host(`barber.workloop.com.br`) || HostRegexp(`^.+\.barber\.workloop\.com\.br$`)'
      priority: 100
      service: barberclub-web
      tls:
        certResolver: ⟨resolver da fase⟩    # fase 1: letsencrypt (HTTP-01); fase 2: cfdns (DNS-01)
        # fase 2: domains: [{ main: barber.workloop.com.br, sans: ['*.barber.workloop.com.br'] }]
  services:
    barberclub-web:
      loadBalancer:
        servers: [{ url: 'http://barberclub-web:3000' }]
```

- **Escape da regex (v1.3, obrigatório).** As duas regras acima estão numa string YAML entre **aspas simples**, e a regex fica entre **crases**. Nesse formato, cada ponto literal leva **barra simples**: `\.`. O YAML com aspas simples não processa `\`, e dentro das crases o Traefik passa a regex literal para o Go RE2.
  - Com **aspas duplas**, o YAML trataria `\` como escape, e aí seria preciso escrever `\\.` para chegar a `\.`.
  - Com aspas simples, `\\.` significa "barra invertida literal seguida de qualquer caractere". Como hostname não tem barra invertida, **nenhum host casa**, todo subdomínio cai no catch-all do EasyPanel, e nenhum erro aparece em log. É uma falha silenciosa.
  - **Não copie a regra de uma versão renderizada** deste documento (HTML, preview, chat, tabela markdown com `\|`). Copie só do bloco YAML do `.md` cru e confira os bytes: `grep -cF 'barber\\.workloop' arquivo.yml` (busca literal da barra dupla) tem de dar 0, e ``grep -cF 'HostRegexp(`^.+\.barber\.workloop' arquivo.yml`` (barra simples) tem de dar 2.
- **Validação do Hermes antes de anunciar o domínio (v1.3, obrigatória).** Comando do arquivo de resposta do Hermes: `curl -H 'Host: xyz.barber.workloop.com.br'` contra o Traefik. A resposta tem de vir **da aplicação** (o 404 neutro do BarberClub, ou o 308 para https na porta 80) e **não** da página de erro do EasyPanel. Forma completa sugerida, com o `curl` do arquivo como núcleo:

  ```bash
  curl -sk -o /dev/null -w '%{http_code}\n' -H 'Host: xyz.barber.workloop.com.br' http://127.0.0.1/      # 308 do redirect-to-https
  curl -sk -H 'Host: xyz.barber.workloop.com.br' https://127.0.0.1/ | grep -c 'Página não encontrada'      # 1: veio do app
  ```

  Se a resposta for a página do EasyPanel, a regra não casou. Nesse caso o domínio não é anunciado e a primeira coisa a conferir é o escape.
- No Traefik v3, a regex do `HostRegexp` é Go RE2, sem chaves `{}` da sintaxe v2. Com `^.+\.` ela casa com qualquer nível (`a.b.barber…`), e assim o host de mais de um nível chega à aplicação, que responde 404 neutro (§2.5). Isso é intencional: a borda não precisa replicar as regras de slug.
- Staging usa o mesmo router com `barber-staging.workloop.com.br`.

**Fase 1: HTTP-01, Host explícito por tenant.**

Na fase 1, o certificado por host vem de um router **só para emissão**, com `Host()` explícito e `certResolver: letsencrypt`. O router `HostRegexp` acima continua levando o tráfego de toda a árvore para a aplicação. O Traefik escolhe o certificado pelo SNI, entre todos os que estão no store, e por isso basta que o certificado exista. Esboço para o Hermes:

```yaml
    barberclub-web-https-certs:            # fase 1: um Host() por nome que precisa de certificado
      entryPoints: [https]
      rule: 'Host(`barber.workloop.com.br`) || Host(`www.barber.workloop.com.br`) || Host(`app.barber.workloop.com.br`) || Host(`admin.barber.workloop.com.br`) || Host(`{slug}.barber.workloop.com.br`)'
      priority: 101
      service: barberclub-web
      tls:
        certResolver: letsencrypt          # HTTP-01; continua servindo os outros domínios da VPS
```

- O HTTP-01 não emite wildcard. O router `https` lista o host base, `www`, e um **`Host(...)` explícito para cada tenant cadastrado**, cada um com certificado próprio. O `HostRegexp` com priority 100 garante que **HTTP** (porta 80) de qualquer `*.barber…` chegue ao app ou ao redirect. Em **HTTPS**, um host sem certificado recebe o certificado padrão autoassinado: o navegador mostra erro de TLS e a requisição não chega à aplicação.
- **Consequência para a D7.** O 404 idêntico vale **só para os hosts roteados com certificado**: base, `www`, `app`, `admin` e cada tenant cadastrado, **inclusive os inativos**. Para os não roteados, o resultado é erro de TLS, e não o 404 da aplicação.
- **Regras operacionais:**
  - O Host de um tenant **nunca** sai do router nem perde o certificado quando o tenant fica `past_due` ou `suspended`, nem quando ele troca de slug. O slug antigo continua roteado e responde o 404 da aplicação. Se o Host saísse, um erro de TLS diferenciaria "existiu ou está inativo" de "ativo".
  - `app.` e `admin.` entram roteados desde a fase 1 e respondem 404 neutro.
  - Quem acrescenta o Host de cada tenant novo é o Hermes. Até haver automação (O10), isso faz parte do onboarding.

**Checklist obrigatório de onboarding manual de tenant (fase 1; v1.3; O10, R13).** São os 6 passos exatos do item 5 da resposta do Hermes. Nenhum pode ser pulado:

```
1. criar o tenant no banco
2. adicionar Host(`{slug}.barber.workloop.com.br`) ao router, com certResolver
3. esperar a emissão
4. curl -sI https://{slug}.barber.workloop.com.br/  -> certificado válido, sem erro TLS
5. curl -s https://{slug}.barber.workloop.com.br/ | grep -c '<slug do tenant>'
6. só então avisar o cliente que o site está no ar
```

- Sem o passo 2, o tenant não tem certificado e o visitante vê aviso de segurança. O cliente não recebe erro, recebe silêncio. O passo 4 existe para pegar isso (R13).
- No passo 2, o `Host()` entra no router de emissão `barberclub-web-https-certs`. A regra de nunca remover o Host vale também aqui.
- O passo 1 conta para o gatilho do R12: ao criar o 4º tenant, a fase 2 é agendada antes do onboarding do 5º.
- Na fase 2 os passos 2 e 3 deixam de existir (o wildcard cobre tudo). Os passos 4 a 6 continuam.
- **Risco de enumeração (R12; v1.3: aceito na fase 1 até o 4º tenant).** Na fase 1, cada certificado por tenant é publicado nos **logs de Certificate Transparency** com o nome `{slug}.barber.workloop.com.br`. O `crt.sh` é uma busca pública, gratuita e histórica. Qualquer concorrente vê cada barbearia que assina, e cada uma que sai. Certificado válido contra erro de TLS também distingue cadastrado de não cadastrado. A garantia anti-enumeração da aplicação vale **entre** hosts roteados e **não** contra quem lê os CT logs.
  - **Regra de virada do Danilo:** quando o **4º tenant** for criado, a fase 2 é **agendada antes do onboarding do 5º**. É um gatilho com número, não "algum dia".
  - O histórico que já foi para os CT logs **não se apaga**. Por isso a virada é feita antes de a lista ficar interessante, não depois.

**Fase 2: DNS-01 com wildcard (desenho técnico do Hermes, item 3 da resposta, v1.3).**

```
token Cloudflare   Zone:DNS:Edit na zona workloop.com.br, em arquivo, modo 600,
                   lido por _FILE — nunca em variável de ambiente nem em argumento
resolver novo      cfdns (lego + provider Cloudflare), separado do letsencrypt HTTP-01,
                   que continua servindo os outros domínios da VPS
router             tls.domains: [{ main: barber.workloop.com.br,
                                   sans: ['*.barber.workloop.com.br'] }]
                   com certResolver: cfdns
validação          primeira emissão conferida no acme.json e no log do lego, sem erro
                   de provider; nomes de variável do lego mudaram entre v4 e v5, então
                   a primeira emissão é o teste, não a documentação
resultado          CT logs passam a mostrar só *.barber.workloop.com.br
                   e todo label recebe certificado válido, caindo na aplicação
```

- **Token.** Permissão `Zone:DNS:Edit` só na zona `workloop.com.br`. Fica num arquivo com modo 600 e é lido pela variável `_FILE` do provider. Nunca vai em variável de ambiente nem em argumento, seguindo a regra da v1.8 de não expor segredo em `docker inspect`.
- **Resolver.** Um `cfdns` novo (lego com o provider Cloudflare), **separado** do `letsencrypt` HTTP-01. Este continua servindo os outros domínios da VPS. Os outros domínios não mudam.
- **Router.** No `barberclub-web-https`: `certResolver: cfdns` e `tls.domains` com `main: barber.workloop.com.br` e `sans: ['*.barber.workloop.com.br']`. O router de emissão por Host da fase 1 (`barberclub-web-https-certs`) sai depois da primeira emissão válida. Os certificados antigos podem expirar sozinhos.
- **Validação.** A primeira emissão é conferida no `acme.json` e no log do lego, sem erro de provider. Como os nomes de variável do lego mudaram entre v4 e v5, **a primeira emissão é o teste, não a documentação**. Depois roda o curl de validação acima, com um label inexistente.
- **Resultado.** Os CT logs passam a mostrar só `*.barber.workloop.com.br`, e todo label recebe certificado válido e cai na aplicação.
- **Consequência para a D7.** O 404 neutro vale para **toda** a árvore `*.barber.workloop.com.br`. Os certificados por tenant emitidos na fase 1 continuam nos CT logs. É histórico que não se apaga.
- **Quando.** É a regra de virada do R12: o agendamento acontece na criação do 4º tenant, antes do onboarding do 5º. A janela do Traefik que destravava esta etapa já foi feita (3.7.19). **O11 fechado.**
- **Staging.** O mesmo desenho, com `barber-staging.workloop.com.br` e `*.barber-staging.workloop.com.br`, que precisa de certificado próprio, porque o wildcard cobre um nível só (v1.8 §12.7).

---

## 3. Roteamento por host

### 3.1 Árvore (App Router)

```
apps/web/src/app/
  layout.tsx                      # raiz mínima (<html><body>), sem marca
  not-found.tsx                   # o 404 neutro ÚNICO (§5)
  landing/                        # prefixo interno do host base (estático, sem banco)
    layout.tsx                    # exige x-bc-route === "landing"
    page.tsx                      # /
    termos/page.tsx               # /termos
    privacidade/page.tsx          # /privacidade
    login/page.tsx, login/actions.ts   # /login (dinâmico; Supabase Auth)
    login/regularizar/page.tsx    # /login/regularizar (v1.1; autenticado; §4.6)
    robots.txt/route.ts           # /robots.txt
    sitemap.xml/route.ts          # /sitemap.xml
  tenant/[tenant]/                # prefixo interno do subdomínio
    layout.tsx                    # exige x-bc-route === `tenant:${tenant}`; getTenantPublic; notFound()
    page.tsx                      # / do tenant
    auth/handoff/route.ts         # /auth/handoff (§4.5)
    robots.txt/route.ts, sitemap.xml/route.ts
  api/health/…                    # qualquer host (contrato da M1)
  api/webhooks/[provider]/…, api/cron/…, api/internal/revalidate/…   # só host base
```

- As pastas da M1 `(cliente)/[tenant]`, `(site)`, `(painel)/painel/[tenant]` e `(superadmin)/admin` **saem da raiz de URL**: `(cliente)` vira `tenant/[tenant]` e `(site)` vira `landing`. O painel vai para o host `app.` e o superadmin para `admin.`, conforme a v1.8, em milestones próprias e com prefixos internos próprios, seguindo o mesmo padrão. O `app/page.tsx` ("Fundação") sai.
- Os prefixos não começam com `_`, porque no App Router pasta com `_` é privada e não roteia.

### 3.2 Regras do rewrite

| Host | Path | Ação |
|---|---|---|
| qualquer | `/_next/*`, `/api/health`, `/api/health/live` | passa direto |
| qualquer | `^/(landing\|tenant)(/\|$)` sem diferenciar caixa | 404 neutro |
| base | `/` → `/landing`, e `/login`, `/login/regularizar`, `/termos`, `/privacidade`, `/robots.txt`, `/sitemap.xml` → `/landing{path}` | rewrite (allowlist exata) |
| base | `/api/webhooks/*`, `/api/cron/*`, `/api/internal/*` | passa direto (cada rota tem autenticação própria) |
| base | qualquer outro, inclusive `/{slug}`, `/painel`, `/admin`, `/precos` | 404 neutro |
| tenant `s` | `/api/*`, exceto health | 404 neutro |
| tenant `s` | qualquer outro | rewrite `/tenant/s{path}`. Na raiz, `/tenant/s`. |
| special ou unknown | qualquer | 404 neutro |

- **404 neutro** é um rewrite para `/tenant/-` (`-` reprova na regex, e o layout chama `notFound()` sem ir ao banco). Assim, todo 404 de host sai do mesmo `app/not-found.tsx`.
- **Headers internos.** O middleware apaga todo `x-bc-*` que vem do cliente e injeta `x-bc-route` (`landing` ou `tenant:{slug}`) via `NextResponse.rewrite(url, { request: { headers } })`. Cada layout interno confere esse header e chama `notFound()` se ele faltar ou divergir. Isso fecha qualquer caminho que escape do middleware.
- **Fuga de prefixo.** Depois de montar `new URL(prefix + path, request.url)`, o middleware confere `target.pathname === prefix || target.pathname.startsWith(prefix + "/")`. Se falhar, devolve 404 neutro. Com o passo 1 já aplicado isso não deveria acontecer, e um teste de fuzz prova.
- **O6, decidido na v1.2:** a recuperação de senha entra na **M5**. Nessa hora `/recuperar` e `/auth/confirm` passam a ser rewrite para `/landing/recuperar` e `/landing/auth/confirm`, com testes de open redirect equivalentes aos do `/login`. **Na M4 os dois dão 404 neutro** no host base. No tenant, `/auth/confirm` também dá 404, porque o único path `/auth/*` do tenant é `/auth/handoff`.
- **`/{slug}` no host base dá 404 neutro, sem 301: DECIDIDO pelo Danilo na v1.1.** Isso substitui o redirect da v1.8. Motivo: redirecionar só os slugs existentes revela quais tenants existem, e redirecionar sempre, sem consultar, manda para um 404 do mesmo jeito e contraria "host base sem banco e só com rotas fixas".

---

## 4. Host base: landing mínima e /login

### 4.1 Landing `/`: estática, sem banco, indexável

- `<h1>BarberClub</h1>` e **uma** frase.
- Botões: **Entrar**, que leva a `/login`, e **Quero testar** → `LINKS.queroTestar` = `https://wa.me/5511974980310?text=Quero%20testar%20o%20BarberClub` (v1.2, link externo, §4.7). Não há formulário nem rota.
- Rodapé: Termos (`/termos`), Privacidade (`/privacidade`) e contato. O contato tem dois itens: o e-mail provisório `danilotecteatro@yahoo.com.br` (`mailto:`) e o WhatsApp de suporte `LINKS.suporte` = `https://wa.me/5511974980310?text=Preciso%20de%20ajuda%20com%20o%20BarberClub`. A troca para `contato@workloop.com.br` via Cloudflare Email Routing é a **P7** (decisão do Danilo, sem DNS na M4).
  - **P7 (v1.3):** o Danilo cria `contato@workloop.com.br` via Cloudflare Email Routing, encaminhando para o e-mail provisório, **antes** de a landing ir ao ar. Isso evita publicar Termos e Privacidade com endereço `@yahoo`. Até lá, `danilotecteatro@yahoo.com.br` continua sendo o oficial. A troca é uma constante (`CONTACT_EMAIL`) mais o deploy. Não bloqueia a M4.
- Sem depoimento, logo de cliente, número de resultado ou print de painel.
- `/termos` e `/privacidade` também são estáticas. O rascunho do texto fica com o **Hermes (P3)** e **não bloqueia** a M4. Até lá, a página publica o texto provisório que o Danilo aprovar.
- `export const dynamic = "force-static"`, canonical absoluto sem barra (§7) e nenhuma chamada ao Supabase. Um teste garante que o build dessas três páginas não importa `server/supabase*`.

### 4.2 `/login`: fluxo

```
GET /login[?next=/x]   (no-store, noindex, Referrer-Policy: no-referrer)
  sem sessão             -> 200 formulário; next validado vai como hidden (descartado se inválido)
  sessão aal1, owner     -> 200 desafio 2FA (TOTP) no próprio /login
  sessão válida          -> RESOLVER

POST action login(email, senha | otp, next)
  falha                  -> 200 formulário, mensagem única "Não foi possível entrar." + rate limit
  ok                     -> se algum tenant do usuário tem role owner e aal != aal2 -> desafio 2FA
                         -> RESOLVER

RESOLVER (v1.1): duas leituras como authenticated, no servidor
  A = public_api.my_login_tenants()            -- trial/active, membership ativa, qualquer papel
  R = public_api.my_regularization_tenants()   -- past_due/suspended, SÓ onde o usuário é owner (§4.6)

  A=0, R=0   -> 200 "Não encontramos uma barbearia ativa vinculada a esta conta."  (sem redirect, sem lista)
  A=0, R>=1  -> 303 Location: /login/regularizar   (relativo, mesmo host; sem handoff)
  A=1, R=0   -> HANDOFF(slug, next)
  A>=2, R=0  -> 200 lista com display_name de cada tenant de A; cada item é um <form method=post>
                com o slug (e next hidden); a action chama de novo my_login_tenants() e só aceita
                slug que esteja na lista -> HANDOFF(slug, next)
  A>=1, R>=1 -> 200 a mesma lista de A (mesmo se A=1, sem redirect automático) + aviso
                "Há barbearias com pendência de assinatura" com link para /login/regularizar
```

- O `redirect()` do Next responde 303 a partir de action e 307 a partir de GET. Os testes aceitam 303 ou 307 e conferem o `Location` exato.
- O rate limit usa `server_api.rate_limit_hit` (já existe) com chave por e-mail em hash e por IP. O IP é o último valor do XFF, conforme a v1.8 §9.1, e é tratado como sinal, não como prova.
- CSRF: o Next confere o `Origin` das server actions contra o Host. **Não** configurar `serverActions.allowedOrigins`.
- A mensagem de erro é a mesma para senha errada e e-mail inexistente.
- **v1.1:** o owner de tenant `past_due` ou `suspended` vai para a tela de regularização (§4.6), e não para "nenhum tenant". O host desse tenant continua 404 para todos (§5).
- **v1.1:** staff (`manager`/`staff`) de tenant `past_due` ou `suspended` não aparece em `A` nem em `R`. Se esse for o único vínculo do usuário, ele vê a mensagem neutra de "nenhum tenant", idêntica à de quem não tem vínculo nenhum.
- **v1.1:** com `A>=1` e `R>=1`, o redirect automático é desligado de propósito. O dono vê a pendência antes de entrar. Isso só acontece para owner, que já passou pelo 2FA.

```sql
create or replace function public_api.my_login_tenants()
returns table (slug text, display_name text, role text)
language sql stable security definer set search_path = ''
as $$
  select t.slug, t.display_name, m.role
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
   where m.user_id = (select auth.uid())
     and m.status = 'active'
     and t.status in ('trial', 'active')
   order by t.display_name, t.slug;
$$;
revoke all on function public_api.my_login_tenants() from public, anon, service_role;
grant execute on function public_api.my_login_tenants() to authenticated;
```

### 4.3 Destino seguro (sem open redirect)

```ts
// packages/core/src/redirect.ts  (isUnsafePath migra de apps/web/src/path-guard.ts para packages/core)
const INTERNAL = /^\/(landing|tenant|auth|login|api|_next)(\/|$)/i;

export function safeNextPath(input: unknown): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 512) return null;
  if (!input.startsWith("/") || input.startsWith("//")) return null;            // URL absoluta, //host
  if (/[\u0000-\u001f\u007f\\]/.test(input) || input.includes("#")) return null; // \, CR/LF/TAB, fragmento
  if (isUnsafePath(input)) return null;                                           // %2f %5c %2e %00 ; .. (M1)
  let u: URL;
  try { u = new URL(input, "https://next.invalid"); } catch { return null; }
  if (u.origin !== "https://next.invalid" || u.username || u.password) return null;
  const out = `${u.pathname}${u.search}`;
  if (out !== input) return null;                         // nada foi reinterpretado pelo parser
  if (u.pathname !== "/" && u.pathname.endsWith("/")) return null;  // só forma canônica
  if (INTERNAL.test(u.pathname)) return null;
  return out;
}

export function tenantUrl(slug: string, path: string, cfg: PublicCfg): string {
  if (!isSlugShape(slug) || isReservedSlug(slug)) throw new Error("bad_slug");
  const host = `${slug}.${cfg.rootDomain}`;
  const u = new URL(path, `${cfg.scheme}://${host}${cfg.port ? `:${cfg.port}` : ""}`);
  if (u.hostname !== host || u.protocol !== `${cfg.scheme}:` || u.username || u.password) throw new Error("bad_target");
  return u.toString();
}
```

- O **host** do destino sai do slug devolvido por `my_login_tenants()` naquele request, e nunca de campo do formulário sem essa conferência. A allowlist é `{slug}.{ROOT_DOMAIN}`, com exatamente um label.
- O **path** sai de `safeNextPath(next) ?? "/"`. Um `next` inválido é descartado em silêncio e nunca volta ecoado no HTML.
- `next` aceita só path relativo. Recusa URL absoluta, `//`, `\`, qualquer esquema (`javascript:`, `data:`, `http:`), encoding perigoso, CR/LF e prefixos internos.

### 4.4 Sessão entre subdomínios: decisão

**Cookie host-only.** Atributos: sem `Domain`, `Secure` (fora de dev), `HttpOnly`, `SameSite=Lax`, `Path=/`. A autenticação roda só no servidor (`@supabase/ssr` com cookie handler de servidor), e o browser não acessa os tokens.

**Rejeitado: `Domain=.barber.workloop.com.br`.**
1. **Isolamento white-label.** A D3 da M1 prevê um `auth.users` com papel de cliente em vários tenants. Com cookie de domínio, quem entra na barbearia A fica logado na B, e o mesmo navegador liga identidades entre marcas que deveriam parecer independentes.
2. **Raio de dano.** Um XSS em qualquer subdomínio (conteúdo de branding é controlado pelo tenant) ganharia requests autenticados em todos os outros. Um subdomínio também pode sobrescrever cookie do domínio pai (cookie tossing e fixação de sessão).
3. **`admin.` com 2FA.** O superadmin não pode compartilhar cookie com 10 mil subdomínios de terceiros.

**Custo aceito:** handoff por tenant e um "Sair" por host. **O5 decidido (v1.2):** "Sair" chama `signOut({ scope: "local" })`, que encerra só a sessão daquele host. "Sair de todos os dispositivos" (`scope: "global"`) fica para uma milestone posterior.

### 4.5 Handoff: a sessão *muda* de host

A sessão criada no `/login`, com AAL2 quando o 2FA é exigido, é transferida para o subdomínio, e o host base apaga o próprio cookie. Assim a mesma família de refresh token nunca é usada por dois hosts ao mesmo tempo, o que dispararia a detecção de reuso do Supabase, e o nível AAL2 é preservado. Gerar outra sessão por magic link no subdomínio produziria AAL1 e quebraria o 2FA do owner.

```sql
create table private.login_handoffs (
  code_hash   bytea primary key,                    -- sha256(code); o código em claro nunca é gravado
  user_id     uuid not null references auth.users (id) on delete cascade,
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  next_path   text not null check (next_path ~ '^/' and next_path !~ '^//' and length(next_path) <= 512),
  sealed      bytea not null,                       -- AES-256-GCM(HANDOFF_KEY, {access_token, refresh_token})
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table private.login_handoffs enable row level security;   -- sem policy
revoke all on private.login_handoffs from public, anon, authenticated, service_role;

create function server_api.create_login_handoff(p_user uuid, p_slug text, p_next text, p_code text, p_sealed bytea)
returns void language plpgsql security definer set search_path = '' as $$
declare v_tenant uuid;
begin
  select t.id into v_tenant
    from public.tenants t join public.memberships m on m.tenant_id = t.id
   where t.slug = p_slug and t.status in ('trial','active')
     and m.user_id = p_user and m.status = 'active';
  if v_tenant is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
  values (extensions.digest(p_code, 'sha256'), p_user, v_tenant, p_next, p_sealed, now() + interval '60 seconds');
end $$;

create function server_api.consume_login_handoff(p_slug text, p_code text)
returns table (user_id uuid, next_path text, sealed bytea)
language sql security definer set search_path = '' as $$
  update private.login_handoffs h set used_at = now()
    from public.tenants t
   where h.code_hash = extensions.digest(p_code, 'sha256')
     and h.used_at is null and h.expires_at > now()
     and t.id = h.tenant_id and t.slug = p_slug and t.status in ('trial','active')
  returning h.user_id, h.next_path, h.sealed;
$$;
-- EXECUTE das duas só para service_role, conforme o padrão server_api da M1.
```

**HANDOFF(slug, next), no host base:**
1. O servidor gera `code` com 32 bytes aleatórios em hex. Sela `{access_token, refresh_token}` da sessão atual com `HANDOFF_KEY`, um segredo novo no EasyPanel.
2. Chama `server_api.create_login_handoff(user.id, slug, safeNext, code, sealed)`. O `user.id` vem de `getUser()`.
3. Apaga os cookies de sessão do host base, sem chamar `signOut`, porque `signOut` revogaria a sessão que está sendo transferida.
4. Redireciona para `tenantUrl(slug, "/auth/handoff?c=" + code)`.

**`GET {slug}.ROOT/auth/handoff?c=`, no tenant** (`no-store`, `noindex`, `Referrer-Policy: no-referrer`):
1. O slug vem do **Host**, nunca do código. Por isso um código emitido para A não serve em B.
2. O servidor chama `consume_login_handoff(slug, c)`. Se der zero linhas, responde 303 para `https://ROOT/login`, uma URL constante e sem parâmetro.
3. Abre o `sealed` e faz `supabase.auth.setSession(...)` com o cookie handler host-only. Depois roda `getUser()` e confere que o `id` é o `user_id` do handoff.
4. Responde 303 com `Location: safeNextPath(next_path) ?? "/"`, relativo ao próprio host.
5. O log de acesso do Traefik não deve registrar a query de `/auth/handoff`. Os tokens nunca passam pela URL, só o código opaco de 60 s e uso único.
6. O cron (`api/cron`) apaga as linhas com mais de 1 dia.

Para trocar de barbearia, o usuário volta ao `/login`, que agora não tem sessão, e entra de novo. É o preço de nunca duplicar a sessão (O5, decidido: logout `local`).

### 4.6 Regularização do dono de tenant inativo (v1.1)

**Onde.** `GET https://barber.workloop.com.br/login/regularizar`. Fica no host base e exige sessão, com `no-store`, `noindex` e `Referrer-Policy: no-referrer`. Fica fora do sitemap e é coberta pelo `Disallow: /login` do robots.

Por que no host base e não no subdomínio:
- **O subdomínio não muda de comportamento.** `{slug}.B` resolve só por `get_tenant_public`, que ignora sessão. Inexistente e inativo continuam 404 byte a byte idênticos para anônimo, cliente, staff e **o próprio dono**.
- **Não existe um "404 com exceção para o dono"**, que seria um sinal de existência.
- **A tela não precisa de handoff** nem de sessão no subdomínio. A sessão do `/login` continua no host base, porque não há troca de host.

**Leitura.** A lógica fica em `private` (`SECURITY DEFINER`, com `has_role` de owner). O `grant execute on function private.has_role(uuid, text[]) to authenticated` **já existe** (está em `20261120107000_rls_grants.sql` e foi verificado pelo Hermes). A v1.2 não cria grant novo para ele. A exposição para o PostgREST é um wrapper fino em `public_api`, só para `authenticated`. A razão: o PostgREST só expõe `public`, `public_api` e `server_api`, e `server_api` roda como `service_role`, onde `auth.uid()` é nulo e o `has_role` não funcionaria.

```sql
create function private.owner_regularization_rows()
returns table (slug text, display_name text, status text, reason_code text, action_code text)
language sql stable security definer set search_path = ''
as $$
  select t.slug,
         t.display_name,
         t.status,
         case t.status when 'past_due' then 'payment_overdue' when 'suspended' then 'subscription_suspended' end,
         'regularize_subscription'                -- destino real: PENDÊNCIA P4
    from public.tenants t
   where t.status in ('past_due', 'suspended')
     and private.has_role(t.id, array['owner'])  -- auth.uid() é owner com membership ativa
   order by t.display_name, t.slug;
$$;
revoke all on function private.owner_regularization_rows() from public, anon, authenticated, service_role, backup_reader;

create function public_api.my_regularization_tenants()
returns table (slug text, display_name text, status text, reason_code text, action_code text)
language sql stable security definer set search_path = ''
as $$
  select r.slug, r.display_name, r.status, r.reason_code, r.action_code
    from private.owner_regularization_rows() r;
$$;
revoke all on function public_api.my_regularization_tenants() from public, anon, service_role, backup_reader;
grant execute on function public_api.my_regularization_tenants() to authenticated;
```

- **Colunas devolvidas:** `slug`, `display_name`, `status`, `reason_code` e `action_code`. Nada além.
  - Não devolve `id`, `owner_email`, `document_number` nem dados de `subscriptions` ou `plans` (valor, vencimento).
  - Não devolve agenda, clientes, equipe, serviços nem ledger.
  - Se a tela precisar mostrar valor ou vencimento da fatura, isso entra junto com a P4, por decisão explícita.
- **Chamada pelo app:** `POST /rest/v1/rpc/my_regularization_tenants?select=slug,display_name,status,reason_code,action_code` com o JWT do usuário e `accept-profile: public_api`. O validador `strict()` recusa coluna extra.
- **Sem enumeração:** a função não recebe parâmetro e só devolve tenants em que o próprio `auth.uid()` é owner ativo. Membership `invited` ou `revoked` não entra.

**Comportamento da rota:**

```
GET /login/regularizar
  sem sessão                    -> 303 Location: /login            (constante; ignora qualquer query)
  sessão aal1 e o usuário é owner -> 303 Location: /login            (o /login exige 2FA antes)
  R = []                        -> 303 Location: /login            (staff, cliente, owner já regularizado)
  R = [..]                      -> 200 tela:
       para cada item: display_name, rótulo do status ("Pagamento em atraso" | "Assinatura suspensa"),
       botão "Regularizar" -> LINKS.regularizar = https://wa.me/5511974980310?text=Quero%20regularizar%20minha%20assinatura
                              (v1.2; constante; na M6 vira a URL da fatura montada no servidor)
       link "Falar com o suporte" -> LINKS.suporte = https://wa.me/5511974980310?text=Preciso%20de%20ajuda%20com%20o%20BarberClub
       botão "Sair" -> signOut({ scope: "local" }) da sessão do host base (O5 decidido)
```

- A rota **não aceita parâmetro** (`next`, `slug` e `return` são ignorados). Por isso não pode virar open redirect. Todos os `Location` são constantes e relativos (`/login`).
- A tela não tem link para `{slug}.B`, que daria 404 de qualquer forma, nem para painel, agenda ou dados do tenant.
- **Na M6**, "Regularizar" passa a apontar para a **fatura**. A URL é **montada no servidor**: a função `server_api`, com conferência de owner, devolve o identificador da fatura, e o servidor junta esse identificador com o domínio do provedor numa allowlist. Nada vem de input do cliente. O gateway não é escolhido aqui. Até a M6, o botão usa o wa.me constante.
- O link wa.me é o mesmo para todos os tenants e não leva slug, nome nem status na query. Assim, a URL não vaza dados do tenant para fora.
- Tenant que volta para `trial` ou `active` sai de `R` e entra em `A` no próximo `/login`. O `revalidateTag` da §6.3 libera o subdomínio.


### 4.7 Links externos, e-mail de contato e CSP (v1.2)

```ts
// packages/config/src/links.ts — constantes; valores copiados LITERALMENTE do arquivo do Danilo/Hermes (P6)
export const LINKS = {
  queroTestar: "https://wa.me/5511974980310?text=Quero%20testar%20o%20BarberClub",
  suporte:     "https://wa.me/5511974980310?text=Preciso%20de%20ajuda%20com%20o%20BarberClub",
  regularizar: "https://wa.me/5511974980310?text=Quero%20regularizar%20minha%20assinatura",   // M6: substituído pela URL da fatura montada no servidor
} as const;
export const CONTACT_EMAIL = "danilotecteatro@yahoo.com.br"; // P7 (v1.3): trocar por "contato@workloop.com.br" quando o Email Routing estiver ativo, antes de a landing ir ao ar
export const EXTERNAL_LINK_ALLOWLIST = ["https://wa.me/"] as const;
```

- **Fonte única.** Os links só existem nessas constantes. Nenhum link externo é montado com input do usuário, slug ou dados do tenant.
- **Na carga do módulo**, `assertExternal(url)` exige:
  - `new URL(url).protocol === "https:"` e `hostname === "wa.me"`;
  - nada de userinfo nem porta;
  - prefixo presente em `EXTERNAL_LINK_ALLOWLIST`.

  O build falha se algum valor não começar com `https://wa.me/` ou contiver marcador `⟦…⟧`, para nunca publicar placeholder.
- **Renderização:** `<a href={LINKS.x} target="_blank" rel="noopener noreferrer">`. O `noopener` impede que a página aberta acesse `window.opener`. O `noreferrer` não manda `Referer`, e assim o path de `/login/regularizar` não chega a terceiros.
- **E-mail:** `<a href={`mailto:${CONTACT_EMAIL}`}>`, como constante validada por regex de e-mail na carga do módulo.
- **Sem rota nova:** não há `/contato` nem formulário. A allowlist de paths do host base (§3.2) não muda por causa desses links.
- **CSP.** A v1.1 não definia CSP. Fica o baseline para o host base e para os tenants:

  `default-src 'self'; img-src 'self' https: data:; script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; connect-src 'self' ⟨SUPABASE_URL⟩; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`

  Um link `<a>` de navegação para `wa.me` **não** depende de CSP: `navigate-to` não existe nos navegadores, e `form-action 'self'` vale só para formulários. Por isso o wa.me não entra em nenhuma diretiva. Se um dia um link virar `<form action=…>`, aí sim precisa de decisão explícita.
- **Teste:** varrer o HTML de `/`, `/login`, `/login/regularizar` e do tenant. Todo `href` absoluto externo tem de estar na allowlist e vir com `rel` contendo `noopener` e `noreferrer`.

---

## 5. 404 neutro e idêntico

> **Escopo por fase (v1.2, E2).** Tudo nesta seção vale para requisições que **chegam à aplicação**. Na **fase 1**, isso inclui só os hosts roteados com certificado (base, `www`, `app`, `admin` e cada tenant cadastrado, ativo ou não). Um host não roteado recebe erro de TLS do catch-all (§2.6, R12). Na **fase 2**, com o wildcard, a garantia cobre toda a árvore `*.barber.workloop.com.br`.

- **Um único `app/not-found.tsx`.** O conteúdo é "Página não encontrada." e `<meta name="robots" content="noindex">`. Não tem marca BarberClub, link para a landing, nome de tenant, cor de tenant nem qualquer menção a "inativo" ou "suspenso".
- **Tenant.** `tenant/[tenant]/layout.tsx` faz `await getTenantPublic(slug)` no corpo do layout, antes de qualquer `<Suspense>`, e chama `notFound()` quando o retorno é `null`. Inexistente e inativo recebem a mesma resposta vazia do mesmo RPC, porque o filtro de status está no SQL. O caminho de código e a ordem de grandeza do tempo são iguais, e o cache negativo de 30 s achata ainda mais a diferença.
- **Inválido, reservado, special, unknown e path fora da allowlist do host base.** Rewrite para `/tenant/-`, e o layout chama `notFound()` sem ir ao banco. O resultado é o mesmo componente e o mesmo HTML.
- **Headers.** São só os do not-found dinâmico do Next (`cache-control: private, no-cache, no-store, max-age=0, must-revalidate`). O `noindex` vai no `<meta>` do `not-found.tsx`, e o Next também o injeta em páginas 404. Em produção, o middleware **não** põe `X-Robots-Tag` nos 404. Um layout não consegue pôr header de resposta, e se o middleware pusesse o header só no 404 de host desconhecido, os headers ficariam diferentes dos do tenant inexistente. Fora de produção, o `X-Robots-Tag` vai em todas as respostas, de forma uniforme. O teste HTTP compara byte a byte o corpo e o conjunto de headers, ignorando `date`.
- **`generateMetadata` nunca decide 404.** No Next 15 o streaming de metadata pode já ter enviado 200 (R2).
- **Falha do banco** (timeout de 2 s ou 5xx do PostgREST) dá **503**: corpo neutro, `no-store`, `Retry-After: 30`, sem cache negativo e sem `notFound()`. Uma queda não pode virar "tenant não existe" em cache.
- **Cache negativo curto.** 30 s no servidor (§6.2). Na resposta HTTP não há cache público (`no-store`), porque não existe CDN na frente: o Cloudflare está em DNS only.

---

## 6. Leitura pública, cache e invalidação

### 6.1 Leitura

O padrão é o do `health/route.ts`: `fetch` cru ao PostgREST, sem SDK, com a chave publicável (papel `anon`).

```ts
// apps/web/src/server/tenant-public.ts
const COLS = "slug,display_name,logo_url,banner_urls,color_primary,color_secondary,color_accent," +
  "address_line,city,state,phone_public,whatsapp_public,instagram_handle,timezone,opening_hours,booking_policy_text";

async function rpcTenantPublic(slug: string): Promise<TenantPublic | null> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/get_tenant_public?select=${COLS}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
      "content-type": "application/json",
      "content-profile": "public_api",
      "accept-profile": "public_api",
    },
    body: JSON.stringify({ p_slug: slug }),
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new UpstreamError(res.status);            // -> 503
  const rows: unknown = await res.json();
  if (!Array.isArray(rows) || rows.length > 1) throw new UpstreamError(500);
  return rows.length ? TenantPublicSchema.strict().parse(rows[0]) : null;   // coluna extra = erro
}
```

- **Proibido:** `select *`, `.select()` sem colunas, `from("tenants")` e chave secreta para leitura pública. Um passo de lint no CI faz grep por `select=\*`, `.select("*")` e `.select()` em `apps/` e `packages/`.
- **RLS.** `anon` continua sem grant em `public.*`, conforme a matriz da M1. O único acesso anônimo é o `EXECUTE` em `get_tenant_public` (`security definer`, colunas fixas, filtro de status). A M4 não cria grant novo para `anon`.
- O RPC só é chamado com slug que passou em `isSlugShape` e não é reservado.
- O validador `strict()` impede que uma coluna nova no SQL vaze para o HTML sem mudança consciente.

### 6.2 Cache

```ts
import { unstable_cache } from "next/cache";
const NEG_TTL_MS = 30_000;
const negative = new LruMap<string, number>(10_000);      // slug -> expiresAt (em memória, por processo)
class Missing extends Error {}

const positive = (slug: string) => unstable_cache(
  async () => { const t = await rpcTenantPublic(slug); if (!t) throw new Missing(); return t; },
  ["tenant-public:v1", slug],
  { revalidate: 300, tags: [`tenant:${slug}`] },
)();

export async function getTenantPublic(slug: string): Promise<TenantPublic | null> {
  const exp = negative.get(slug);
  if (exp && exp > Date.now()) return null;
  try { return await positive(slug); }
  catch (e) {
    if (e instanceof Missing) { negative.set(slug, Date.now() + NEG_TTL_MS); return null; }
    throw e;                                              // UpstreamError -> 503, nada cacheado
  }
}
```

| Caso | TTL | Onde |
|---|---|---|
| Positivo | 300 s | `unstable_cache`, tag `tenant:{slug}` |
| Negativo | 30 s | LRU próprio com no máximo 10 mil entradas. Lançar exceção dentro do `unstable_cache` impede que ele guarde `null`. |
| Erro | sem cache | resposta 503 |

### 6.3 Invalidação

| Evento | Ação |
|---|---|
| Tenant criado | `negative.delete(slug)` e `revalidateTag("tenant:"+slug)` |
| `status` muda | `revalidateTag("tenant:"+slug)` |
| `tenant_branding` muda | `revalidateTag("tenant:"+slug)` |
| Slug muda | `revalidateTag` do antigo e do novo, e `negative.delete(novo)` |

- **Primário:** a server action que grava (painel ou superadmin) invalida depois do commit.
- **Backstop:** triggers `AFTER INSERT/UPDATE OF slug, status` em `tenants` e `AFTER INSERT/UPDATE` em `tenant_branding` gravam em `public.outbox_events` (já existe) o evento `tenant_public_changed` com os slugs. O workflow n8n (`infra/n8n`, padrão HMAC da v1.8) chama `POST https://ROOT/api/internal/revalidate` com corpo `{"slugs":[…]}`.
  - Headers: `X-BC-Timestamp` e `X-BC-Signature = hex(hmac_sha256(REVALIDATE_SECRET, ts + "." + body))`. A janela é de 5 min e a comparação é em tempo constante.
  - Cada slug é validado pela regex. A rota só existe no host base e responde 404 neutro nos outros hosts.
- **Último recurso:** os TTLs de 300 s e 30 s.

### 6.4 Troca de slug

**Decisão: o slug antigo dá 404 neutro, sem redirect, e não pode ser reusado por outro tenant.**
- **Sem redirect.** Um redirect do antigo para o novo publica o vínculo entre os dois nomes e prova que o tenant existe. Também obrigaria a servir histórico para sempre.
- **Sem reuso.** Se outro tenant pegasse o slug antigo, quem tinha o link antigo cairia nessa outra barbearia, o que abre espaço para phishing. Por isso existe `public.tenant_slug_history` (§9.2).
- **Custo aceito.** Links e SEO antigos quebram.
- **O4 decidido (v1.2):** a troca de slug é feita **só pelo superadmin**, por função `server_api`/admin com 2FA. O owner não troca o slug pelo painel. O histórico bloqueia o slug antigo **para sempre**: `tenant_slug_history` não tem expiração e não existe rotina que apague linhas dele.
  - **Exceção, mantida da v1.1:** o próprio tenant pode voltar ao slug antigo, e só ele.
  - **Teste pgTAP:** `authenticated`, inclusive owner, não consegue `update public.tenants set slug` (não há grant de `UPDATE` em `tenants`).

---

## 7. Canonical, sitemap e robots

### 7.1 Canonical

```ts
export function canonicalUrl(target: { kind: "landing" } | { kind: "tenant"; slug: string }, path: string): string {
  const host = target.kind === "landing" ? cfg.rootDomain : `${target.slug}.${cfg.rootDomain}`;
  const p = path === "/" ? "/" : path.replace(/\/+$/, "");
  return new URL(p, `${cfg.scheme}://${host}`).toString();     // sem query, fragmento ou porta
}
```

- **Landing:** `https://barber.workloop.com.br/`, `…/termos` e `…/privacidade`. O `/login` não tem canonical e leva `noindex`.
- **Tenant:** `https://{slug}.barber.workloop.com.br/` e `https://{slug}.barber.workloop.com.br/{path}`.
- O canonical vai por `alternates.canonical` como **string absoluta**, sem depender de `metadataBase`. Nunca é montado a partir do Host recebido, então maiúsculas, porta ou IP não contaminam o resultado.
- A raiz continua `/`, conforme `docs/requisitos-m4.md`. Nenhum outro canonical termina em `/`.

### 7.2 sitemap.xml (por host, `application/xml`)

| Host | Conteúdo |
|---|---|
| Base | `https://ROOT/`, `https://ROOT/termos`, `https://ROOT/privacidade`. Fica de fora `/login`. |
| Tenant resolvido | As páginas públicas do tenant existentes na M4 (no mínimo `/`), em URLs absolutas e sem barra final. Cache igual ao do tenant. |
| Não resolvido | Inválido, reservado, special ou unknown: o middleware já faz rewrite para `/tenant/-`, e a resposta é o 404 neutro (HTML). Slug com formato válido mas inexistente ou inativo: o route handler devolve 404 `text/plain` com corpo fixo `Not Found` e `no-store`. Como route handler não renderiza `not-found.tsx`, esse corpo é diferente do HTML, mas é **idêntico** entre inexistente e inativo. |
| `APP_ENV` diferente de `production` | 404 em qualquer host |

### 7.3 robots.txt (por host, `text/plain`)

| Caso | Corpo |
|---|---|
| Produção, host base | `User-agent: *` / `Allow: /` / `Disallow: /login` / `Sitemap: https://barber.workloop.com.br/sitemap.xml` |
| Produção, tenant resolvido | `User-agent: *` / `Allow: /` / `Disallow: /auth/` / `Sitemap: https://{slug}.barber.workloop.com.br/sitemap.xml` |
| Produção, não resolvido (inexistente, inativo, inválido, reservado, special, unknown) | `User-agent: *` / `Disallow: /`. O corpo é **idêntico** em todas essas classes. Quem gera é o route handler `tenant/[tenant]/robots.txt`: para inválido, special ou unknown ele recebe `-` via rewrite e não consulta o banco; para slug de formato válido, `getTenantPublic` devolve `null`. |
| `APP_ENV` diferente de `production` | `User-agent: *` / `Disallow: /` em qualquer host, e `X-Robots-Tag: noindex, nofollow` em toda resposta |

---

## 8. Ordem no middleware (o Next está com `skipMiddlewareUrlNormalize`, então o path chega cru)

```ts
// apps/web/src/middleware.ts (M4) — esqueleto
export function middleware(request: NextRequest) {
  // 1) RECUSA DE PATH (M1, inalterada): 400 {"error":"bad_path"}, no-store, sem Location
  const raw = rawPathFromUrl(request.url);
  if ([request.nextUrl.pathname, raw].some(isUnsafePath)) return badPath();
  const path = raw.startsWith("/") ? raw : request.nextUrl.pathname;
  const search = request.nextUrl.search;

  // 2) CANONICALIZAÇÃO (path + host), num salto só
  const host = classifyHost(request.headers.get("host"), cfg.rootDomain);
  if (host.kind === "bad") return badHost();                         // 400 {"error":"bad_host"}, no-store
  const needsSlash = path !== "/" && path.endsWith("/");
  const fixed = needsSlash ? canonicalLocation(path, search) : `${path}${search}`;   // M1; null => 400
  if (fixed === null) return badPath();
  if (host.kind === "redirect") {
    return NextResponse.redirect(absoluteUrl(host.host, fixed), 308); // https + host canônico (constantes)
  }
  if (needsSlash) return redirectSameOrigin(request, fixed);          // M1: 308, Location reduzido a /foo

  // 3) HOST BASE (sem banco) OU TENANT OU 404 NEUTRO
  if (isPassthrough(path)) return NextResponse.next();               // /_next/*, /api/health, /api/health/live
  if (/^\/(landing|tenant)(\/|$)/i.test(path)) return neutral404(request);
  const headers = withoutBcHeaders(request.headers);
  switch (host.kind) {
    case "base":    return routeBase(request, path, headers);        // allowlist -> /landing/*; /api/* do base
    case "tenant":  return routeTenant(request, host.slug, path, headers);  // /api/* -> 404; resto -> /tenant/{slug}*
    default:        return neutral404(request);                      // special | unknown -> /tenant/-
  }
}
```

**Por que essa ordem:**
1. **A recusa vem primeiro.** Tudo depois dela concatena ou reinterpreta o path.
   - Se o 308 viesse antes, `/%2e%2e/` viraria `Location: /%2e%2e`, um redirect "válido" para path perigoso.
   - Se o rewrite viesse antes, `/..%2ftenant%2foutra` viraria `/tenant/slug/..%2ftenant%2foutra`. Um decode posterior pode resolver isso para **outro tenant**.
   - Recusar no texto cru, com até 4 passes de decode (o `path-guard` da M1), fecha a travessia entre prefixos. A v1.8 exige isso porque o Traefik não normaliza com segurança (GHSA-cp28).
2. **A canonicalização vem antes da resolução.** Só uma forma de URL chega ao cache, ao canonical e ao sitemap. Host e path saem num redirect só: `www.B/foo/` vai direto para `https://B/foo`, sem cadeia de dois 308.
3. **A resolução vem por último e sem banco.** O host base nunca toca no Supabase. O tenant só toca no layout, com cache. Um Host malformado dá 400 no passo 2, porque o redirect de host depende do parser. Esse 400 vem depois da recusa de path, então os 400 da M1 têm precedência e não mudam.

**Armadilhas:**
- **Encoding.** `%2e`, `%2f`, `%5c`, `%00` e codificação dupla (`%252e`) dão 400 pela M1. Nunca decodificar "para ajudar" antes do passo 1.
- **`%2e%2e` simples e `..` literal.** O servidor do Next colapsa esses segmentos antes do middleware, e o resultado é 404 (registrado na M1). Na M4 esse 404 continua, agora como 404 neutro.
- **`//evil.com/`.** O Next responde 308 `Location: /evil.com/` antes do middleware (M1). É mesmo origin e não é open redirect. Em seguida, `/evil.com/` leva 308 para `/evil.com`, que dá 404 neutro. Há teste para isso.
- **`//` no meio do path** (`/a//b`). A M4 não colapsa: dá 404 neutro, porque nenhuma rota casa. Não vira redirect.
- **Prefixo interno em outra caixa** (`/Tenant`, `/LANDING`). O bloqueio não diferencia caixa.
- **`x-bc-*` forjado pelo cliente.** O middleware remove esses headers antes do rewrite.
- **Location absoluto.** O do 308 de host é montado com `PUBLIC_SCHEME` e o host canônico. Nunca usa `request.nextUrl.origin`, que deriva do Host. O 308 de barra continua relativo, como na M1.
- **CR/LF na query.** O `canonicalLocation` da M1 recusa, e o redirect de host reaproveita o mesmo valor `fixed`.
- **Env em runtime.** `ROOT_DOMAIN` tem de ser lido em runtime no `next start` standalone, e não embutido no build (R5).

---

## 9. Slugs reservados

### 9.1 Lista

A base são os 65 itens que já estão em `packages/config/src/index.ts`, que repetem a v1.8:

> app, admin, api, www, mail, smtp, imap, pop, mx, ftp, ns1, ns2, cdn, static, assets, img, media, files, storage, staging, stage, dev, test, demo, sandbox, status, health, docs, help, ajuda, suporte, blog, painel, login, entrar, cadastro, auth, sso, oauth, billing, pagamento, pagamentos, checkout, webhook, webhooks, cron, n8n, traefik, easypanel, supabase, barber, barberclub, workloop, root, superadmin, sistema, conta, minha-conta, pwa, sw, manifest, security, abuse, postmaster, barber-staging

A M4 acrescenta:

```
webmail email autodiscover autoconfig wpad pop3 sftp ns ns3 ns4 dns www1 www2 www3
localhost local internal intranet vpn proxy gateway edge origin
signup signin logout logon sair register registrar account password senha recuperar reset
verify verificar callback oauth2 mfa 2fa otp token session sessao
preview beta alpha null undefined true false none nil nan
git ci build deploy grafana metrics monitor prometheus logs log backup backups db database
redis postgres s3 upload uploads download downloads public private server
ws wss socket realtime rest graphql rpc functions studio kong
termos privacidade contato precos planos sobre landing site home inicio
cliente clientes agendar agenda reserva reservas
support contact hostmaster webmaster noreply no-reply info ssl tls acme well-known
owner manager staff tenant tenants hermes grok
```

**Prefixos reservados:** `cdn-`, `api-`, `admin-`, `app-`, `mail-`, `static-`, `assets-`, `staging-`, `preview-`, `dev-`, `test-`, `barber-`, `barberclub-`, `workloop-`, `xn--`. O `barber-` já cobre `barber-staging`.

Itens com 1 ou 2 caracteres (`mx`, `sw`, `ns`, `db`, `ci`, `ws`) já reprovam pelo mínimo de 3. Ficam na lista mesmo assim, como defesa caso o mínimo mude.

### 9.2 Onde vive

- **Código.** O arquivo é `packages/config/src/reserved.ts`, com `RESERVED_SLUGS` (Set), `RESERVED_PREFIXES` e `isReservedSlug()`. O parser e o middleware leem dele sem I/O. A `reservedSlugs` atual passa a ser reexportada daqui.
- **Banco.** É a fonte de verdade para criar ou renomear tenant:

```sql
create table public.reserved_slugs (slug text primary key, reason text not null default 'system');
create table public.reserved_slug_prefixes (prefix text primary key);
create table public.tenant_slug_history (
  slug text primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  retired_at timestamptz not null default now()
);
alter table public.reserved_slugs enable row level security;
alter table public.reserved_slug_prefixes enable row level security;
alter table public.tenant_slug_history enable row level security;
-- sem policy e sem grant para anon/authenticated; backup_reader recebe SELECT pelo default privilege (D37)

create function private.assert_slug_allowed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug)
     or exists (select 1 from public.reserved_slug_prefixes p where starts_with(new.slug, p.prefix)) then
    raise exception 'slug_reserved' using errcode = '23514';
  end if;
  if exists (select 1 from public.tenant_slug_history h where h.slug = new.slug and h.tenant_id <> new.id) then
    raise exception 'slug_retired' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    insert into public.tenant_slug_history (slug, tenant_id) values (old.slug, old.id) on conflict (slug) do nothing;
  end if;
  return new;
end $$;
create trigger tenants_slug_allowed before insert or update of slug on public.tenants
  for each row execute function private.assert_slug_allowed();

-- reservar um nome já em uso também falha: nunca existe tenant com slug reservado
create function private.assert_reserved_free() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'reserved_slugs'
     and exists (select 1 from public.tenants t where t.slug = new.slug) then
    raise exception 'slug_in_use' using errcode = '23514';
  end if;
  if tg_table_name = 'reserved_slug_prefixes'
     and exists (select 1 from public.tenants t where starts_with(t.slug, new.prefix)) then
    raise exception 'prefix_in_use' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reserved_slugs_free before insert or update on public.reserved_slugs
  for each row execute function private.assert_reserved_free();
create trigger reserved_prefixes_free before insert or update on public.reserved_slug_prefixes
  for each row execute function private.assert_reserved_free();
```

- O `CHECK` não aceita subconsulta. Por isso o formato fica como `CHECK` (§2.3) e a regra de reservados fica no trigger.
- **Carga.** `scripts/gen-reserved-slugs-sql.mjs` gera a migration a partir do `reserved.ts`, com `insert … on conflict do nothing`. Para remover um item é preciso uma migration explícita com `delete`.
- **Sincronia.** No job `db` do CI, `scripts/check-reserved-sync.mjs` compara `RESERVED_SLUGS` e `RESERVED_PREFIXES` com `public.reserved_slugs` e `public.reserved_slug_prefixes`. A diferença tem de ser vazia nos dois sentidos, senão o CI falha.

---

## 10. Testes

Nas tabelas abaixo, `B` = `barber.workloop.com.br`.

### 10.1 Unitários (vitest)

**`isSlugShape`**

| Entrada | Esperado |
|---|---|
| `abc`, `a1b`, `123`, `a-b`, `minha-barbearia`, `a`×32 | true |
| `a`, `ab`, `a`×33 | false |
| `-abc`, `abc-`, `a--b`, `ab--cd`, `xn--abc` | false |
| `Abc`, `ab_c`, `ab.c`, `ab c`, `ção`, `""` | false |

**`isReservedSlug`**

| Entrada | Esperado |
|---|---|
| `www`, `api`, `app`, `admin`, `painel`, `login`, `barberclub`, `null`, `undefined` | true |
| `cdn-01`, `barber-staging`, `staging-x`, `app-x` | true (prefixo) |
| `barbearia-do-ze`, `cdnx`, `apis`, `appbarber` | false |

**`classifyHost`** (`root = B`)

| Host | Esperado |
|---|---|
| `null`, `""`, `a b.B`, `a_b.B`, `%61bc.B`, `çao.B`, `user@B` | bad |
| `abc.B:`, `abc.B:0`, `abc.B:65536`, `abc.B:abc`, `a:b:c`, `abc..B`, `.B`, `B..`, label de 64, `[::1`, `[zz::1]` | bad |
| `B`, `BARBER.WORKLOOP.COM.BR`, `B:443`, `B:3000` | base |
| `B.`, `www.B`, `WWW.B:443`, `www.B.` | redirect `B` |
| `abc.B`, `ABC.B`, `abc.B:3000` | tenant `abc` |
| `abc.B.` | redirect `abc.B` |
| `app.B`, `admin.B` | special |
| `a.b.B`, `www.abc.B`, `ab.B`, `-ab.B`, `xn--abc.B`, `a--b.B`, `api.B`, `cdn-1.B` | unknown |
| `127.0.0.1`, `127.0.0.1:3000`, `[::1]`, `[::1]:3000` | unknown |
| `evil.com`, `B.evil.com`, `xB` (sem o ponto), `workloop.com.br`, `localhost`, `barber-staging.workloop.com.br` | unknown |

Com `root=localhost`: `localhost:3000` dá base e `abc.localhost:3000` dá tenant `abc`.

**`safeNextPath`**

| Entrada | Esperado |
|---|---|
| `/`, `/agendar`, `/agendar?d=2026-11-21` | igual à entrada |
| `https://evil.com`, `http:/evil.com`, `//evil.com`, `/\evil.com`, `\\evil.com`, `/%2F%2Fevil.com`, `/%5cevil.com` | null |
| `javascript:alert(1)`, `data:text/html,x`, ` /x`, `/x\r\nLocation: //e`, `/x\t` | null |
| `/a/../b`, `/a/%2e%2e/b`, `/a;b`, `/x#f`, `/x/` | null |
| `/login`, `/auth/handoff`, `/tenant/x`, `/landing`, `/api/x`, `/_next/x` | null |
| 513 caracteres, `123`, `undefined`, `[]` | null |

**`tenantUrl`**

| Entrada | Esperado |
|---|---|
| `("abc","/x")` | `https://abc.B/x` |
| `("abc","//evil.com")`, `("abc","https://evil.com")` | lança erro (o hostname diverge) |
| `("api","/")`, `("ab","/")`, `("a.b","/")` | lança erro |

**Middleware** (in-memory, `NextRequest` com header `host`)

| Requisição | Esperado |
|---|---|
| Todos os casos 400 do `middleware.test.ts` da M1, com Host base, tenant, unknown e **sem** Host | 400 `bad_path` (precede o `bad_host`), `no-store`, sem Location |
| `/foo/`, `/foo/?a=1`, `/foo///`, com Host base e com Host tenant | 308 relativo para `/foo`, `/foo?a=1` e `/foo` |
| `www.B/foo/?a=1` | um único 308 para `https://B/foo?a=1` |
| `abc.B.` `/x/` | um único 308 para `https://abc.B/x` |
| Host ausente ou `a b.B`, path `/` | 400 `bad_host` |
| base: `/`, `/login`, `/login/regularizar`, `/termos`, `/privacidade`, `/robots.txt`, `/sitemap.xml` | rewrite para `/landing…` com `x-bc-route: landing` |
| base: `/precos`, `/recursos`, `/painel`, `/admin`, `/abc`, `/api/foo` | rewrite para `/tenant/-` (404 neutro) |
| tenant `abc`: `/`, `/agendar` | rewrite para `/tenant/abc` e `/tenant/abc/agendar` com `x-bc-route: tenant:abc` |
| tenant `abc`: `/login`, `/api/webhooks/x`, `/api/internal/revalidate` | 404 neutro |
| qualquer host: `/tenant/xyz`, `/Tenant/xyz`, `/landing`, `/landing/login` | 404 neutro |
| `/api/health`, `/api/health/live` com Host `127.0.0.1` ou `localhost` | `next()` |
| Request com `x-bc-route: tenant:outra` | o header chega sobrescrito |
| Host `abc.B` com `X-Forwarded-Host: outra.B` | tenant `abc` |
| Fuzz de 10 mil paths aleatórios | o rewrite nunca sai do prefixo |

**Sincronia e lint**

| Verificação | Esperado |
|---|---|
| `check-reserved-sync.mjs` | diferença vazia nos dois sentidos |
| grep `select=\*`, `.select("*")`, `.select()` | 0 ocorrências |
| Build de `landing/{page,termos,privacidade}` | não importa `server/supabase*` nem `server/tenant-public` |
| `canonicalUrl` em todos os paths do sitemap | nenhum termina em `/`, exceto a raiz |

### 10.2 pgTAP (job `db`)

**Formato e reservados**
- Inserir tenant com slug `a`, `ab`, `-abc`, `a--b`, `xn--ab`, `ABC` ou `a`×33 falha com `check_violation`.
- Inserir tenant com slug `api`, `app`, `cdn-01` ou `barber-x` falha com `slug_reserved`. Um `update … set slug='admin'` também falha.
- Trocar `abc` por `abd` grava `abc` em `tenant_slug_history`. Outro tenant que tenta `abc` falha com `slug_retired`. O tenant original consegue voltar para `abc`.
- `insert into reserved_slugs ('abd')`, com o tenant `abd` existindo, falha com `slug_in_use`.

**Grants**
- `anon` não faz `select` em `reserved_slugs`, `reserved_slug_prefixes`, `tenant_slug_history` nem `private.login_handoffs`.
- `anon` não executa `my_login_tenants`.
- `anon` e `authenticated` não executam `server_api.*_login_handoff`.

**Funções**
- `get_tenant_public('suspenso')` e `get_tenant_public('naoexiste')` devolvem 0 linhas.
- `my_login_tenants()` devolve 0, 1 ou 3 linhas para usuários com 0, 1 ou 3 memberships ativas. Não aparecem membership `revoked` ou `invited` nem tenant `suspended` ou `past_due`. O usuário nunca vê tenant de outro.
- `create_login_handoff` para um tenant sem membership falha com 42501.
- `consume_login_handoff` devolve 0 linhas quando a chamada é a segunda, quando o handoff venceu ou quando o slug é outro.

### 10.3 HTTP cru contra o build (`next build && next start`)

> **Fase (v1.2):** os testes desta seção e da §10.4 falam **direto com o `next start`**, sem Traefik. Valem igual na **F1 e na F2**, porque medem a aplicação. O que depende da borda (certificado e roteamento) está na §10.5, marcado F1 ou F2.

`scripts/check-host-http.mjs` segue o padrão de `check-path-http.mjs`: socket cru, Host manual e nenhuma normalização no cliente.
- **Job `app`:** roda contra `scripts/stub-postgrest.mjs`.
- **Job `db`:** roda contra o Supabase local.
- **Fixtures:** `ativo` (active), `trial1` (trial), `suspenso` (suspended) e `devedor` (past_due). `naoexiste` não existe.

Equivalente manual:

```bash
B=barber.workloop.com.br; P=3456; U=http://127.0.0.1:$P
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' --path-as-is -H "Host: $B" "$U/foo/%252e%252e/bar"   # 400
curl -si --path-as-is -H "Host: www.$B" "$U/termos/"                                              # 308 https://B/termos
curl -si --path-as-is -H "Host: ativo.$B" -H "X-Forwarded-Host: suspenso.$B" "$U/"                # 200 de ativo
diff <(curl -s -H "Host: naoexiste.$B" "$U/") <(curl -s -H "Host: suspenso.$B" "$U/")              # vazio
printf 'GET / HTTP/1.0\r\n\r\n' | nc 127.0.0.1 $P                                                 # 400 (sem Host)
```

**M1 sem regressão.** O `check-path-http.mjs` passa a usar `Host: B`, e os casos 400 e 308 rodam também com `ativo.B`, `naoexiste.B` e `127.0.0.1`.

| Host | Path | Esperado |
|---|---|---|
| B, `ativo.B`, `naoexiste.B`, `127.0.0.1` | `/foo/%252e%252e/bar`, `/foo/%252fbar`, `/foo/%5c`, `/foo/%2fbar`, `/..;x/`, `/..;x`, `/a;b` | 400 `bad_path`, `no-store`, sem Location |
| B, `ativo.B` | `/foo/`, `/foo/?a=1`, `/api/health/` | 308 para `/foo`, `/foo?a=1` e `/api/health` |
| B | `//evil.com/` | 308 para `/evil.com/`. O Location não tem `//` nem `://`. |
| B | `/foo/%2e%2e/bar`, `/foo/../bar` | 404 neutro (HTML) |
| B, `localhost`, `127.0.0.1` | `/api/health/live` | 200 |

**Host**

| Host | Path | Esperado |
|---|---|---|
| ausente (HTTP/1.0) | `/` | 400 |
| `a b.B`, `x_y.B`, `B:abc`, `B:70000`, `a..B` | `/` | 400 `bad_host` (ou o 400 do próprio Node) |
| B, `BARBER.WORKLOOP.COM.BR`, `B:443` | `/` | 200. Tem `<h1>BarberClub</h1>`, os botões "Entrar" e "Quero testar" e canonical `https://B/`. |
| `B.` | `/termos?x=1` | 308 para `https://B/termos?x=1` |
| `www.B` | `/` e `/termos/` | 308 para `https://B/` e para `https://B/termos`, num salto |
| `ativo.B`, `ATIVO.B`, `ativo.B:3000`, `trial1.B` | `/` | 200 com a página do tenant e canonical `https://{slug}.B/` |
| `ativo.B.` | `/x/` | 308 para `https://ativo.B/x` |
| `ativo.B` com `X-Forwarded-Host: suspenso.B` ou `evil.com` | `/` | 200 e canonical de `ativo` |
| `suspenso.B` com `X-Forwarded-Host: ativo.B` | `/` | 404 neutro |

**404 idêntico**

| Host | Path | Esperado |
|---|---|---|
| `naoexiste.B`, `suspenso.B`, `devedor.B`, `api.B`, `app.B`, `admin.B`, `ab.B`, `xn--abc.B`, `a--b.B`, `a.b.B`, `127.0.0.1`, `[::1]`, `evil.com` | `/` | 404. Corpo byte a byte igual entre todos e conjunto de headers igual (sem `date`). Tem `noindex`. Não contém "inativo", "suspenso", "BarberClub", nome de tenant nem link para a landing. |
| `naoexiste.B` × `suspenso.B` | `/`, 200 requisições alternadas | medianas de tempo a menos de 20% uma da outra (alerta, não bloqueio) |
| `ativo.B` | `/login`, `/termos`, `/privacidade`, `/precos` | 404 neutro |
| B | `/precos`, `/recursos`, `/painel`, `/admin`, `/ativo` | 404 neutro (não redireciona para o subdomínio) |
| B, `ativo.B` | `/tenant/ativo`, `/Tenant/ativo`, `/landing`, `/landing/login` | 404 neutro |
| `ativo.B` | `/api/webhooks/x`, `/api/internal/revalidate` | 404 neutro |
| `ativo.B`, com o stub fora do ar | `/` | 503 e `no-store`. Quando o stub volta, a resposta seguinte já é 200, sem negativo em cache. |

**Cache e invalidação**

| Passo | Esperado |
|---|---|
| `novo.B` | 404 |
| criar `novo` e chamar `POST /api/internal/revalidate` com HMAC | 200 em seguida |
| suspender `novo` e chamar revalidate | 404 idêntico |
| renomear `ativo` para `ativo2` | `ativo.B` dá 404 sem Location. `ativo2.B` dá 200. |
| revalidate sem HMAC, com HMAC errado ou com timestamp de mais de 5 min | 401 no host base. Em `ativo.B`, 404 neutro. |

**SEO**

| Host | Path | Esperado |
|---|---|---|
| B | `/robots.txt` | `Allow: /`, `Disallow: /login`, `Sitemap: https://B/sitemap.xml` |
| B | `/sitemap.xml` | exatamente `https://B/`, `https://B/termos` e `https://B/privacidade`. Sem `/login` e sem barra final fora da raiz. |
| `ativo.B` | `/robots.txt`, `/sitemap.xml` | Sitemap do próprio host. URLs começam em `https://ativo.B/`, sem barra final. |
| `naoexiste.B`, `suspenso.B`, `api.B`, `a.b.B` | `/robots.txt` | 200 `Disallow: /`, idêntico entre os quatro |
| `naoexiste.B` × `suspenso.B` | `/sitemap.xml` | 404 com o mesmo corpo |
| cada URL do sitemap | GET | 200 sem redirect. O `<link rel=canonical>` é igual à própria URL. |
| B | `/login` | `noindex`, `no-store`, sem canonical |
| build com `APP_ENV=staging` | `/robots.txt` em B e `ativo.B` | `Disallow: /` e `X-Robots-Tag: noindex, nofollow` em toda resposta |

**`/login` e handoff** (Supabase local)

Usuários de teste:
- `u0`: nenhum tenant.
- `u1`: staff de `ativo`.
- `u3`: staff de `ativo`, `trial1` e `outro`.
- `us`: **staff** (não owner) só de `suspenso`.
- `uos`: **owner** só de `suspenso`, com TOTP (v1.1, §10.4).
- `umix`: owner de `ativo` e de `suspenso` (v1.1, §10.4).
- `uo`: owner de `ativo`, com TOTP.

| Caso | Esperado |
|---|---|
| `u1` faz login | 303 para `https://ativo.B/auth/handoff?c=<64 hex>`. O host base apaga os cookies de sessão (`Set-Cookie` com `Max-Age=0`). |
| GET nesse Location com `Host: ativo.B` | 303 com `Location: /`. `Set-Cookie` **sem** `Domain`, com `HttpOnly`, `SameSite=Lax` e `Secure` fora de dev. `getUser()` no tenant devolve `u1`. |
| repetir o mesmo `c`, usar `c` de `ativo` em `trial1.B` ou usar `c` depois de 61 s | 303 para `https://B/login` |
| `u1` com `next=/agendar` | a cadeia termina em `ativo.B` com `Location: /agendar` |
| `u1` com `next` = `https://evil.com`, `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `javascript:alert(1)`, `/x%0d%0aSet-Cookie:a=b`, `/login` ou `/tenant/outro` | o destino final é `/` em `ativo.B`. Nenhum Location da cadeia aponta para host fora de {B, `ativo.B`}, e nenhum header é injetado. |
| `u3` faz login | 200 no `/login` com exatamente 3 itens. Nenhum outro slug aparece no HTML. |
| `u3` faz POST de escolha com `slug=naoexiste`, `suspenso`, o slug de outro usuário, `evil.com` ou `ativo.evil.com` | nenhum Location para esses hosts. A resposta é 200 com a lista. |
| `u3` faz POST com `slug=trial1` | 303 para `https://trial1.B/auth/handoff?c=…` |
| `u0` faz login, e `us` (staff de suspenso) faz login | 200 com a mesma mensagem neutra, sem Location e sem lista. O trecho da mensagem é idêntico nos dois casos. |
| `uo` faz login só com a senha | 200 com o desafio 2FA, sem handoff. Depois do TOTP válido, vem o handoff e a sessão no tenant tem `aal2`. |
| senha errada × e-mail inexistente | mesma mensagem e mesmo status |
| N falhas seguidas | resposta de limite (`rate_limit_hit`) |
| POST de server action no host B com `Origin: https://ativo.B` | recusado pelo Next |
| cookie de sessão do B enviado para `ativo.B` | não autentica (o cookie é host-only) |


### 10.4 Testes novos da v1.1

#### (b) Migration de slug com mínimo de 3

O script `scripts/test-slug-migration.sh` roda no job `db`, num banco descartável. Ele usa psql com `ON_ERROR_STOP` e `--single-transaction`, igual ao `apply-migrations.sh`.

| # | Setup | Ação | Esperado |
|---|---|---|---|
| SM1 | Aplica as migrations até a anterior a esta. Insere 2 tenants com slug de 1 caractere (`q` e `z`, que a constraint antiga aceita) e 1 tenant válido. Grava `md5(string_agg(t::text, ',' order by id))` de `tenants`. | Aplica a migration nova. | Sai com código ≠ 0 e SQLSTATE `23514`. A mensagem tem exatamente `tenants_slug_shape: 2 slug(s) fora da regra de 3 a 32 caracteres; migration abortada sem alterar dados`. Como a mensagem é comparada por igualdade exata, nenhum slug pode aparecer nela. Os campos `DETAIL` e `CONTEXT` do erro também não podem conter `'q'` nem `'z'`. |
| SM2 | Logo depois do SM1 | Lê o estado do banco. | O md5 de `tenants` é igual ao de antes. `pg_get_constraintdef` de `tenants_slug_shape` é a definição **antiga**. A versão nova **não** está em `supabase_migrations.schema_migrations`. |
| SM3 | O mesmo banco, sem os tenants de 1 caractere (removidos pelo próprio teste, fora da migration) | Aplica a migration. | Sucesso. A constraint nova está com `convalidated = true`. |
| SM4 | Banco limpo, todas as migrations aplicadas | Roda o `apply-migrations.sh` de novo. | `aplicadas=0` (idempotente). |
| SM5 | Transação concorrente segurando `ROW EXCLUSIVE` em `tenants` | Aplica a migration. | Falha em cerca de 5 s com `lock_timeout` (55P03), sem alterar nada. |
| SM6 | Query de diagnóstico sobre a base do SM1 | Executa a query. | `curtos=2`, `longos=0`, `hifen_duplo=0`, `fora_da_regra=2`. Funciona dentro de `begin transaction read only`. |

pgTAP depois da migration (estende o §10.2):
- `insert` com slug de 1 ou 2 caracteres (`a`, `ab`) falha com `check_violation`.
- `insert` com 33 ou mais caracteres falha com `check_violation`.
- `insert` com 3 e com 32 caracteres passa.
- `update` de um slug válido para `ab` falha com `check_violation`.

#### (d) Regularização

**Unitários (vitest):**

| Caso | Esperado |
|---|---|
| `resolveLogin(A=[], R=[])` | `{ kind: "none" }` |
| `resolveLogin(A=[], R=[x])` | `{ kind: "redirect", location: "/login/regularizar" }` |
| `resolveLogin(A=[a], R=[])` | `{ kind: "handoff", slug: a }` |
| `resolveLogin(A=[a], R=[x])` | `{ kind: "choose", items: [a], pending: true }`, sem handoff automático |
| `resolveLogin(A=[a,b], R=[])` | `{ kind: "choose", items: [a,b], pending: false }` |
| `regularizarRoute(sem sessão)`, `(R=[])`, `(aal1 owner)` | `Location: /login`, sempre a constante |
| `regularizarRoute` com `?next=https://evil.com`, `?slug=x`, `?return=//e` | Os parâmetros são ignorados. Só sai `200` ou `Location: /login`. |
| O componente da tela recebe uma linha com campos extras | O validador `strict()` falha. Nada além de `slug`, `display_name`, `status`, `reason_code` e `action_code` é renderizado. |
| Middleware com Host base e `/login/regularizar` | rewrite para `/landing/login/regularizar` |
| Middleware com Host `ativo.B` e `/login/regularizar` | 404 neutro |

**pgTAP de permissão:**
- `anon` não executa `public_api.my_regularization_tenants()` (42501).
- `anon` e `authenticated` não executam `private.owner_regularization_rows()` diretamente.
- `service_role` não executa nenhuma das duas.
- Como `uos` (owner de `suspenso`): a função devolve 1 linha, `suspenso`, com status `suspended`, `reason_code = subscription_suspended` e `action_code = regularize_subscription`. A linha tem exatamente essas 5 colunas, conferido em `pg_get_function_result`.
- Como `owner` de um tenant `past_due`, a função devolve `payment_overdue`.
- Como `us` (staff de `suspenso`) e como `manager` de `suspenso`: 0 linhas.
- Como `umix`: 1 linha (`suspenso`). `ativo` não aparece, porque ele está em `my_login_tenants`.
- Como owner com membership `revoked` ou `invited` num tenant suspenso: 0 linhas.
- Como owner de `suspenso` consultando tenants de **outro** owner suspenso: nunca aparecem.
- A função não tem parâmetro: `pg_proc.pronargs = 0`.
- Depois de `update tenants set status='active'` em `suspenso`: 0 linhas na regularização e 1 linha em `my_login_tenants()`.

**HTTP cru contra o build** (Supabase local):

| Caso | Esperado |
|---|---|
| `uos` faz login (senha + TOTP) | 303 com `Location: /login/regularizar`, sem handoff e sem `Set-Cookie` apagando a sessão do host B |
| `uos` faz `GET /login/regularizar` com `Host: B` | 200, `no-store`, `noindex`. O HTML tem o nome de `suspenso` e o rótulo "Assinatura suspensa". **Não** tem agenda, cliente, serviço, staff, valor (`R$`), e-mail do owner, `document_number` nem link para `suspenso.B`. |
| `uos` faz `GET /login/regularizar?next=https://evil.com&slug=ativo` | 200 com a mesma tela. Nenhum `Location`. O HTML não contém `evil.com` nem `ativo`. |
| `umix` faz login | 200 com a lista de `ativo` e o aviso com link `/login/regularizar`. **Não** há redirect automático. |
| `us` (staff de suspenso) faz login | 200 com a mensagem neutra "nenhum tenant", idêntica à de `u0` |
| `us` faz `GET /login/regularizar` | 303 com `Location: /login` |
| Anônimo faz `GET /login/regularizar` | 303 com `Location: /login` |
| `uos` com sessão aal1 (sem TOTP) faz `GET /login/regularizar` | 303 com `Location: /login` |
| Anônimo e `uos` (com o cookie dele, se existisse em `suspenso.B`) fazem `GET /` em `suspenso.B` | 404 **byte a byte idêntico** ao de `naoexiste.B`, com os mesmos headers (sem `date`) |
| `uos` faz `GET /auth/handoff?c=<forjado>` em `suspenso.B` | 404 neutro, porque o host não resolve. Não é 303. |
| `/login/regularizar` com `Host: ativo.B` ou `suspenso.B` | 404 neutro |
| `/login/regularizar/` | 308 para `/login/regularizar` (M1) |
| `/sitemap.xml` com `Host: B` | Não lista `/login/regularizar`. |


### 10.5 Testes novos da v1.2

**Links externos e contato** (unitário e HTML do build; F1 e F2):

| Caso | Esperado |
|---|---|
| `LINKS.*` com um marcador `⟦…⟧` não preenchido | build falha em `assertExternal` |
| `LINKS.*` com `http://wa.me/…`, `https://wa.me.evil.com/…`, `https://user@wa.me/…` ou `javascript:` | build falha |
| `GET /` (Host B) | "Quero testar" tem `href` igual a `LINKS.queroTestar`, `target="_blank"` e `rel` com `noopener` e `noreferrer`. O rodapé tem `mailto:` igual a `CONTACT_EMAIL` e o link de suporte igual a `LINKS.suporte`. |
| `GET /login/regularizar` (uos) | "Regularizar" tem `href` igual a `LINKS.regularizar` e "Falar com o suporte" tem `href` igual a `LINKS.suporte`, ambos com `rel="noopener noreferrer"`. A query dos links não contém slug, nome nem status. |
| Varredura de todo `href` absoluto em `/`, `/login`, `/login/regularizar` e `/` de `ativo.B` | Só aparecem `https://wa.me/…` (allowlist), `mailto:` e os hosts do próprio BarberClub. |
| Header `Content-Security-Policy` nas mesmas páginas | Tem `form-action 'self'`, `frame-ancestors 'none'` e `base-uri 'none'`. |
| Host B, `/contato`, `/recuperar`, `/auth/confirm` | 404 neutro na M4 (O6) |

**Troca de slug e logout** (pgTAP e HTTP; F1 e F2):
- `authenticated` (owner) não consegue `update public.tenants set slug`. A troca só passa pelo caminho de superadmin.
- Depois de uma troca, o slug antigo continua em `tenant_slug_history`, e nenhum job remove a linha. Outro tenant que tenta o slug antigo leva `slug_retired`, mesmo um ano depois (simulado com `retired_at` antigo).
- O "Sair" no host B chama `signOut` com `scope: "local"`, e a sessão já transferida para `ativo.B` continua válida. Isso é intencional: o logout global vem depois.

**Borda** (contra staging, pelo Traefik, com `curl --resolve`; executado pelo Hermes):

| Fase | Caso | Esperado |
|---|---|---|
| F1+F2 | `curl -sI http://<qualquer>.barber-staging.workloop.com.br/x` | 308 para `https://…` (router http priority 100). **Não** é a página do EasyPanel. |
| F1+F2 | `curl -s https://barber-staging.workloop.com.br/` | 200 da landing, com certificado válido |
| F1 | `https://ativo.<staging>/`, `https://suspenso.<staging>/`, `https://app.<staging>/` (Host roteado) | `ativo` dá 200. `suspenso` e `app` dão 404 neutro, byte a byte igual ao de um slug renomeado e ainda roteado. Certificado válido em todos. |
| F1 | `https://naoroteado.<staging>/` | Erro de TLS ou certificado autoassinado, e a requisição não chega à aplicação. **Esperado e documentado** (R12). O teste só confirma que **não** sai o HTML de tenant, a landing ou a página do EasyPanel com certificado válido. |
| F1 | Tenant passa para `suspended` | O Host continua no router, o certificado continua válido e a resposta é o 404 neutro. Nunca vira erro de TLS. |
| F2 | `https://naoexiste.<staging>/`, `https://a.b.<staging>/`, `https://ab.<staging>/`, `https://suspenso.<staging>/` | Certificado wildcard válido e 404 neutro byte a byte idêntico em todos |
| F2 | crt.sh do domínio de staging, depois da fase 2 | Os certificados novos só têm `*.barber-staging…` e o host base |
| F1+F2 (ex-R5) | Confirmação de que o middleware lê `ROOT_DOMAIN` em runtime: o mesmo build com `ROOT_DOMAIN=barber-staging.workloop.com.br`, e `curl -s -o /dev/null -w '%{http_code}' -H 'Host: barber-staging.workloop.com.br' http://127.0.0.1:3000/` mais `-H 'Host: barber.workloop.com.br'` | 200 no host de staging. 404 neutro no host de produção, que nesse ambiente é desconhecido. |
| F1+F2 | Na fase 1, os hosts `evil.com` e IP do §10.3 nem chegam ao BarberClub pelo Traefik: outros routers ou o catch-all os atendem. | O comportamento de 404 da aplicação para esses hosts vale só no `next start` direto, como defesa em profundidade. |

---

## 11. Riscos, decididos e pontos em aberto (atualizado na v1.3)

### Decididos

| # | Tema | Decisão | Versão |
|---|---|---|---|
| ~~O1~~ | Destino do login | Leva ao **subdomínio do tenant**. `app.` e `admin.` dão 404 neutro na M4. | v1.1 |
| ~~O2~~ | `/{slug}` no host base | 404 neutro, sem 301 | v1.1 |
| ~~O3~~ | Dono de tenant inativo | Vai para `/login/regularizar`. Staff não-owner vê "nenhum tenant". | v1.1 |
| ~~(b)~~ | Slug com 3 a 32 caracteres | A migration falha mostrando só a contagem. Não renomeia nem apaga. | v1.1 |
| ~~P1~~ | "Quero testar" | Link wa.me constante do arquivo (`LINKS.queroTestar`) | v1.2 |
| ~~P2~~ | Contato | E-mail provisório do arquivo e wa.me de suporte (`LINKS.suporte`) | v1.2 |
| ~~P4~~ | "Regularizar" | Link wa.me constante do arquivo (`LINKS.regularizar`). Na M6 passa a ser a fatura, com URL montada no servidor. | v1.2 |
| ~~P3~~ | Termos e Privacidade | Rascunho com o **Hermes**. Não bloqueia a M4. | v1.2 |
| ~~P5~~ | Diagnóstico de slug | Primeiro passo da **M2**, com a contagem no log. Não bloqueia. | v1.2 |
| ~~O4~~ | Troca de slug | Só pelo superadmin, com bloqueio **permanente** no histórico | v1.2 |
| ~~O5~~ | Logout | `scope: "local"`. "Sair de todos" fica para depois. | v1.2 |
| ~~O6~~ | Recuperação de senha | Na **M5**. `/recuperar` e `/auth/confirm` entram na allowlist nessa hora. Na M4 dão 404. | v1.2 |
| ~~E1~~ | Catch-all do EasyPanel | Router do Traefik v3 com priority 100, configurado pelo Hermes no deploy. **Regra literal só no YAML da §2.6.** Barra simples, validado por curl (v1.3). | v1.2/v1.3 |
| ~~E2~~ | Certificado e escopo do 404 | **Fase 1:** HTTP-01 com Host por tenant, e o 404 idêntico só nos hosts roteados. **Fase 2:** DNS-01 com wildcard e 404 em toda a árvore. | v1.2 |
| ~~R5~~ | `process.env` em runtime | Medido pelo Hermes. Sai dos riscos. Fica o curl em staging (§10.5). | v1.2 |
| - | `has_role` para `authenticated` | O grant já existe. Nenhum grant novo. | v1.2 |
| ~~P7~~ | E-mail de contato | `contato@workloop.com.br` via Cloudflare Email Routing, criado pelo Danilo **antes** de a landing ir ao ar. Até lá, o provisório é oficial. Não bloqueia a M4. | v1.3 |
| ~~O11~~ | Quando entra a fase 2 | Gatilho: quando o **4º tenant** for criado, a fase 2 é agendada **antes do onboarding do 5º**. A janela do Traefik já foi feita (3.7.19). | v1.3 |
| - | Escape da regex do router | Barra simples (`\.`) em YAML com aspas simples e crases. Validação por `curl -H 'Host: xyz.barber.workloop.com.br'` antes de anunciar o domínio. | v1.3 |
| - | Onboarding manual de tenant | Checklist obrigatório de 6 passos (§2.6) | v1.3 |
| - | Host nunca sai do router | Nem quando o tenant fica inativo, nem quando troca de slug. Confirmado pelo Hermes. | v1.2/v1.3 |

### Pendências

| # | Pendência | Dono | Bloqueia a M4? |
|---|---|---|---|
| ~~P6~~ | **Fechada.** Links wa.me e e-mail provisório copiados literalmente de `resposta-hermes-m4-v1.1.md`; o arquivo não traz outros pontos. | — | Não. |
| **P7-exec** | Criar `contato@workloop.com.br` no Cloudflare Email Routing e trocar `CONTACT_EMAIL`. Decidido (v1.3); falta executar. | Danilo | Não (bloqueia só a publicação da landing com o e-mail definitivo) |
| **P3** | Rascunho de Termos e Privacidade | Hermes | Não |
| **P5** | Rodar o diagnóstico de slug como passo 1 da M2 e registrar a contagem | Hermes, com autorização do Danilo | Não |

### Riscos

| # | Risco | Mitigação |
|---|---|---|
| R1 | Mais de uma réplica: o cache e o `revalidateTag` são locais | `cacheHandler` compartilhado ao escalar. Até lá, o TTL de 300 s. |
| R2 | `notFound()` com streaming pode sair com status 200 | Decidir o 404 no corpo do layout. O teste HTTP exige 404. Plano B: middleware em runtime Node. |
| R3 | `forwardedHeaders.insecure=true` (medido na v1.8; o estado depois da 3.7.19 não foi confirmado). A CVE-2026-29054 foi corrigida pela 3.7.19. | A M4 não usa XFH. O IP é só sinal. |
| R4 | Handoff com `setSession` no Supabase Cloud (rotação de refresh token, `aal2`) | Spike antes de implementar. Se falhar, o usuário refaz o 2FA no tenant. |
| R6 | Slug inválido ou reservado responde mais rápido, sem banco | Isso só revela regras públicas. |
| R7 | O `check-path-http.mjs` usa `slug.B` | Trocar para `Host: B` e rodar a matriz por host. |
| R8 | A troca de slug sem redirect quebra links | Decisão consciente. Agora só o superadmin troca (O4). |
| R9 | `HANDOFF_KEY` e `REVALIDATE_SECRET` | Ficam no EasyPanel. Os handoffs de 60 s expiram na rotação. |
| R10 | `ACCESS EXCLUSIVE` em `tenants` na migration (b) | `lock_timeout` de 5 s e horário de pouco tráfego |
| R11 | A sessão do owner suspenso fica no host base | Só a tela de regularização. Nenhuma leitura operacional. |
| **R12** | **Fase 1:** os CT logs (`crt.sh`, busca pública, gratuita e histórica) publicam `{slug}.barber.workloop.com.br` de cada tenant, e erro de TLS contra certificado válido distingue cadastrado de não cadastrado. Isso enumera quem assina e quem sai. | **Aceito na fase 1 até o 4º tenant (v1.3).** Na criação do 4º, a fase 2 é agendada antes do onboarding do 5º. Nunca tirar do router o Host de tenant inativo ou renomeado. O histórico dos CT logs não se apaga, e por isso a virada acontece antes de a lista ficar interessante. |
| **R13** | **Fase 1:** um tenant criado sem o Host correspondente no router (deriva operacional) fica sem certificado. O visitante vê aviso de segurança, e o cliente não recebe erro: recebe silêncio. | **Checklist obrigatório de onboarding (§2.6, 6 passos).** O passo 4 (`curl -sI`) pega exatamente isso. Some na fase 2. |
| **R15** | Regra do router com escape errado (`\\.` em aspas simples) não casa com nada e cai no catch-all do EasyPanel sem log (v1.3) | Copiar só do YAML cru, conferir com `grep -cF` e validar com curl antes de anunciar (§2.6) |
| **R16** | Na fase 2, os nomes de variável do lego mudaram entre v4 e v5 | A primeira emissão é o teste: conferir no `acme.json` e no log do lego (§2.6) |
| **R14** | Os links wa.me ficam fixos no build: trocar o número exige deploy | Aceito. Os links são constantes de config e não ficam no banco. |

### Pontos em aberto

| # | Ponto |
|---|---|
| O7 | Domínio próprio (`tenant_domains`) fora da M4 |
| O8 | Declarar a trava `m4-*` em `ops/locks.yml` antes de qualquer edição |
| O9 | A v1.8 previa "painel em leitura" para tenant suspenso. A decisão (d) não dá acesso ao painel. Confirmar na milestone do painel. |
| O10 | Fase 1: o Host entra **manualmente** pelo Hermes, com o checklist de 6 passos (§2.6) até haver automação. Fica em aberto se vale automatizar antes da fase 2, que já está prevista no máximo para o 5º tenant e torna o passo desnecessário. |
| O12 | Data do "sair de todos os dispositivos" (`scope: "global"`), adiado no O5 |
| O13 | Estado de `forwardedHeaders.insecure` depois da 3.7.19 (o arquivo não diz). Não afeta a M4 (R3). |

---

## 12. O que fica com o Hermes (v1.3)

Do lado do Hermes, a M4 está aprovada (resposta à v1.2, item 6). Ficam com ele:

| # | Item | Quando | Referência |
|---|---|---|---|
| H1 | **Router e TLS no deploy:** routers `barberclub-web-http`/`-https` (priority 100, regex com barra simples), router de emissão da fase 1 e validação com `curl -H 'Host: xyz.barber.workloop.com.br'` (a resposta tem de vir da aplicação, não do EasyPanel) antes de anunciar o domínio. Na fase 2: token em arquivo 600 via `_FILE`, resolver `cfdns`, `tls.domains` com wildcard e primeira emissão conferida no `acme.json` e no log do lego. | Deploy da M4. Fase 2 no gatilho do 4º tenant. | §2.6, E1, E2, D18, R12, R15, R16 |
| H2 | **Migration (b)** (slug com 3 a 32 caracteres): rodar a query de diagnóstico read-only antes e aplicar com `lock_timeout` em horário de pouco tráfego | Junto da M4/M2, conforme o plano | §9, D15, R10 |
| H3 | **Diagnóstico P5** como passo 1 da M2, com a contagem registrada no log | M2 | P5 |
| H4 | **P3:** rascunho de Termos e Privacidade | Antes de a landing ir ao ar | P3 |
| H5 | **Checklist de onboarding manual de tenant** (6 passos, §2.6) em todo tenant novo, até a fase 2 ou até haver automação | A cada tenant | D19, O10, R13 |

Ficam com o **Danilo**: criar `contato@workloop.com.br` (P7-exec) e autorizar a migration (b) e o diagnóstico P5.

