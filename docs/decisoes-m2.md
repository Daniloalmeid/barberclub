# Decisões da M2-1

O desenho da M2 v1.1 fica de fora deste arquivo. Aqui está o que a migration `20261123100000_m2_invites.sql` faz. Decisão do Danilo em 21/11: owner novo só pelo superadmin.

- `invite_member` só grava papel `staff` ou `manager`. Papel `owner`, ou qualquer outro, responde `invalid_role` (`42501`). Quem chama é owner ativo daquele tenant. Staff, manager, owner de outro tenant, `anon` e `service_role` recebem `not_allowed` ou não têm `EXECUTE`.
- Quem já tem membership `active` no tenant não é alterado. O papel e o status ficam como estavam, inclusive se o alvo é o próprio owner. Convite de quem está `invited` ou `revoked` volta o status para `invited` e grava o papel pedido. Isso fecha o K15: o `ON CONFLICT` antigo rebaixava uma membership ativa para `invited`.
- `accept_invite` só muda `invited` para `active`, e só quando `auth.uid()` é o `user_id` daquela membership. Outro usuário, o owner do tenant ou alguém sem convite recebe `not_allowed`.
- `revoke_member` é do owner ativo daquele tenant. Marca a membership como `revoked`. Não revoga o último owner ativo.
- `change_member_role` não promove ninguém a `owner`. Também não rebaixa o último owner ativo. Com dois owners ativos, um pode rebaixar ou revogar o outro.
- Owner novo só entra por `appoint_owner`, e só se `auth.uid()` está em `platform_admins`. Sem membership, ou com status `invited` ou `revoked`, a linha fica `owner` e `invited`; a pessoa ativa em `accept_invite`. Membership `active` de outro papel passa a `owner` e continua `active`. Owner ativo não é reescrito. `invite_member` e `change_member_role` continuam sem criar owner, mesmo para o superadmin.
- A trava do último owner conta só membership `active` com papel `owner` e tranca essas linhas em ordem de `user_id` antes de rebaixar ou revogar.
