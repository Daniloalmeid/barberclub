-- Reversão: restaurar o consume que só marca used_at, sem zerar sealed.

create or replace function server_api.consume_login_handoff(p_slug text, p_code text)
returns table (user_id uuid, next_path text, sealed bytea)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctid tid;
  v_user uuid;
  v_next text;
  v_sealed bytea;
begin
  select h.ctid, h.user_id, h.next_path, h.sealed
    into v_ctid, v_user, v_next, v_sealed
    from private.login_handoffs h
    join public.tenants t on t.id = h.tenant_id
   where h.code_hash = extensions.digest(p_code, 'sha256')
     and h.used_at is null
     and h.expires_at > now()
     and t.slug = p_slug
     and t.status in ('trial', 'active')
   for update of h;
  if not found then
    return;
  end if;
  update private.login_handoffs
     set used_at = now(),
         sealed = '\x'::bytea
   where ctid = v_ctid;
  user_id := v_user;
  next_path := v_next;
  sealed := v_sealed;
  return next;
end
$$;
