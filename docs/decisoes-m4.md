# Decisões da implementação da M4

O desenho aprovado está em `docs/m4-arquitetura.md`, copiado sem alteração.

- O `redirect()` do Next durante o render de uma página é 307. O anônimo em `/login/regularizar` recebe 303 pelo middleware, antes da página, com `Location: /login`.
- A página de tenant ativo é um route handler para poder responder 503 quando o PostgREST falha. O 404 de slug inválido, reservado, inexistente e inativo continua no `app/not-found.tsx`.
- `private.login_handoffs` também revoga o `backup_reader`. O selo do handoff não entra no backup.
- A troca de slug da M4 é `server_api.rename_tenant_slug`, só com `EXECUTE` para `service_role`. Não há tela em `admin.`, que segue 404.
- O POST de `/login` contra o GoTrue e o TOTP não entram no HTTP cru. O HTTP cobre o GET anônimo, o 303 e o 404. A decisão de quantos tenants o usuário vê está em `resolveLogin`, e as funções estão no pgTAP.
- As páginas da landing leem o header interno no layout, então não ficam `force-static`. O conteúdo não consulta o banco.
- O 404 interno usa o segmento `/tenant/x`. O `-` do desenho não é roteado pelo Next. `x` tem um caractere, falha na forma do slug e não consulta o banco.
- A migration do slug é um único `DO`. O `supabase start` não abre transação, e `LOCK TABLE` solto falha com `25P01`. O lock, a contagem e o `ALTER` continuam atômicos.
