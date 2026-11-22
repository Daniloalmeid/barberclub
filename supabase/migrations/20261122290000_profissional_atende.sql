-- Profissional novo precisa poder atender.
--
-- Daniel foi criado pela tela e não apareceu no /agendar: o agendamento lista
-- profissional por serviço (public.staff_services), e add_staff copiava só o horário
-- (work_schedules). Sem serviço vinculado ele existe, tem agenda, e não é oferecido a
-- ninguém — o pior tipo de bug: nada dá erro.
--
-- Regra adotada: profissional novo entra fazendo TODOS os serviços ativos da casa.
-- Restringir serviço por profissional é exceção e vai precisar de tela própria; o padrão
-- não pode ser "não faz nada".

create or replace function server_api.add_staff(p_tenant uuid, p_actor uuid, p_name text, p_commission_bps integer default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nome text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if length(v_nome) < 2 or length(v_nome) > 60 then
    raise exception 'nome_invalido' using errcode = '22023';
  end if;
  if coalesce(p_commission_bps, 0) < 0 or coalesce(p_commission_bps, 0) > 10000 then
    raise exception 'percentual_invalido' using errcode = '22023';
  end if;

  insert into public.staff (tenant_id, display_name, active, commission_bps)
  values (p_tenant, v_nome, true, coalesce(p_commission_bps, 0))
  returning id into v_id;

  -- Horário da casa: sem janela ele não teria agenda.
  insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
  select p_tenant, v_id, w.weekday, w.start_time, w.end_time
    from public.work_schedules w
   where w.tenant_id = p_tenant
     and w.staff_id = (select st.id from public.staff st
                        where st.tenant_id = p_tenant and st.id <> v_id
                        order by st.display_name limit 1);

  -- Serviços da casa: sem serviço ele não é oferecido no agendamento.
  insert into public.staff_services (tenant_id, staff_id, service_id, active)
  select p_tenant, v_id, s.id, true
    from public.services s
   where s.tenant_id = p_tenant and s.active
  on conflict do nothing;

  return v_id;
end
$$;

-- Conserta quem já está sem serviço (Daniel e futuros).
insert into public.staff_services (tenant_id, staff_id, service_id, active)
select st.tenant_id, st.id, s.id, true
  from public.staff st
  join public.services s on s.tenant_id = st.tenant_id and s.active
 where st.active
   and not exists (select 1 from public.staff_services ss where ss.staff_id = st.id)
on conflict do nothing;
