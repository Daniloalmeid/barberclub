# Decisões da M2-1

O desenho da M2 v1.1 fica de fora deste arquivo. Aqui está o que a migration `20261123100000_m2_invites.sql` faz. Decisão do Danilo em 21/11: owner novo só pelo superadmin.

- `invite_member`, `revoke_member`, `change_member_role` e `appoint_owner` exigem `auth.jwt()->>'aal' = 'aal2'`. JWT AAL1, só com a senha, recebe `not_allowed` (`42501`). `accept_invite` não exige AAL2: quem aceita é o próprio convidado.
- `invite_member` só grava papel `staff` ou `manager`. Papel `owner`, ou qualquer outro, responde `invalid_role` (`42501`). Quem chama é owner ativo daquele tenant, e não pode convidar a si mesmo (`not_allowed`). Staff, manager, owner de outro tenant, `anon` e `service_role` recebem `not_allowed` ou não têm `EXECUTE`.
- K15, como no desenho: convidar quem já está `active` responde `already_member` (`23505`) e não muda papel nem status. Convite pendente de owner, criado por `appoint_owner`, não é rebaixado por `invite_member` nem por `change_member_role` (`not_allowed`). Convite pendente de `staff` ou `manager` pode trocar de papel e continua `invited`. Quem está `revoked` e não é owner volta para `invited`.
- `accept_invite` só muda `invited` para `active`, e só quando `auth.uid()` é o `user_id` dessa linha. Sem convite `invited` para esse usuário no tenant, a resposta é `invite_not_found` (`P0002`).
- `revoke_member` é do owner ativo daquele tenant e não aceita alvo `auth.uid()`. Marca a membership como `revoked`. Se existe `staff` desse usuário no tenant, `active` passa a falso.
- P-M2-4, adotada por padrão pelo Orquestrador em 21/11; Danilo pode revisar. `change_member_role` nunca promove a `owner`. Nunca rebaixa nem remove owner: alvo com papel `owner` é recusado, no `change_member_role` e no `revoke_member`. O último owner ativo continua protegido (`last_owner`).
- Owner novo só entra por `appoint_owner`, e só se `auth.uid()` está em `platform_admins` e o JWT é AAL2. Sem membership, ou com status `invited` ou `revoked`, a linha fica `owner` e `invited`; a pessoa ativa em `accept_invite`. Membership `active` de outro papel passa a `owner` e continua `active`. Owner ativo não é reescrito.
- As quatro escritas e o aceite pegam um advisory lock por tenant antes de locar a linha do alvo. Dois owners ao mesmo tempo não geram `40P01`.
- Tenant `suspended` recusa convite, revogação e troca de papel.
- `backup_reader` não tem `EXECUTE` nessas funções. Elas são `security definer` com `search_path` vazio. `authenticated` não tem `INSERT` nem `UPDATE` em `memberships`.

## Lacuna de AAL2 que este PR não fecha

As funções da M1 abaixo continuam aceitando um JWT AAL1. Não foram alteradas aqui:

- `public_api.book_appointment`
- `public_api.cancel_appointment`
- `public_api.create_time_off`
- `public_api.complete_appointment`
- `public_api.record_commission_payout`

`get_tenant_public`, `list_services`, `list_staff` e `list_free_slots` também não leem `aal`. São leitura pública, concedida a `anon`.
