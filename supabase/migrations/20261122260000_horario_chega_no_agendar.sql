-- Horário editado no painel tem de chegar no /agendar.
--
-- Existiam duas fontes de verdade: tenant_branding.opening_hours (o JSON que o painel
-- grava e a home exibe) e public.work_schedules (a tabela por profissional que o
-- public_api.list_free_slots usa para gerar horário). Mudar segunda e terça no painel
-- alterava a vitrine e não alterava a agenda — o cliente continuava vendo o horário
-- antigo.
--
-- Agora set_hours grava nos dois. A tabela manda, o JSON é espelho de exibição.
--
-- Consequência declarada: o horário é da casa e vale para toda a equipe ativa. Escala
-- individual por profissional vai precisar de tela própria (work_schedules já suporta);
-- hoje, sobrescrever a tabela é o certo porque nenhuma tela cria escala individual.

create or replace function server_api.set_hours(p_tenant uuid, p_actor uuid, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dia text;
  v_valor text;
begin
  perform private.assert_can_manage(p_tenant, p_actor);
  if p_hours is null or jsonb_typeof(p_hours) <> 'object' then
    raise exception 'horarios_invalidos' using errcode = '22023';
  end if;

  for v_dia, v_valor in select key, value #>> '{}' from jsonb_each(p_hours) loop
    if v_dia not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') then
      raise exception 'dia_invalido: %', v_dia using errcode = '22023';
    end if;
    if v_valor is not null and v_valor <> ''
       and v_valor !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'horario_invalido: %', v_dia using errcode = '22023';
    end if;
    if v_valor ~ '^..:..-..:..$' and substring(v_valor, 1, 5) >= substring(v_valor, 7, 5) then
      raise exception 'horario_invertido: %', v_dia using errcode = '22023';
    end if;
  end loop;

  insert into public.tenant_branding (tenant_id, opening_hours)
  values (p_tenant, p_hours)
  on conflict (tenant_id) do update set opening_hours = excluded.opening_hours;

  -- Espelho na tabela que o motor de slots lê de verdade.
  delete from public.work_schedules w where w.tenant_id = p_tenant;

  insert into public.work_schedules (tenant_id, staff_id, weekday, start_time, end_time)
  select p_tenant, st.id, m.dow,
         split_part(h.faixa, '-', 1)::time,
         split_part(h.faixa, '-', 2)::time
    from public.staff st
    cross join (values ('mon', 1), ('tue', 2), ('wed', 3), ('thu', 4),
                       ('fri', 5), ('sat', 6), ('sun', 0)) as m(dia, dow)
    cross join lateral (select nullif(p_hours ->> m.dia, '') as faixa) h
   where st.tenant_id = p_tenant
     and st.active
     and h.faixa is not null
     and h.faixa ~ '^..:..-..:..$';
end
$$;
