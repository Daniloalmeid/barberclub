-- Reservados, histórico de slug, login e regularização da M4.
-- Reversão: drop trigger, drop function e drop table destas relações.

create table public.reserved_slugs (
  slug text primary key,
  reason text not null default 'system'
);
create table public.reserved_slug_prefixes (
  prefix text primary key
);
create table public.tenant_slug_history (
  slug text primary key,
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  retired_at timestamptz not null default now()
);
alter table public.reserved_slugs enable row level security;
alter table public.reserved_slug_prefixes enable row level security;
alter table public.tenant_slug_history enable row level security;

create table private.login_handoffs (
  code_hash bytea primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  next_path text not null check (next_path ~ '^/' and next_path !~ '^//' and length(next_path) <= 512),
  sealed bytea not null,
  expires_at timestamptz not null,
  used_at timestamptz
);
alter table private.login_handoffs enable row level security;
revoke all on private.login_handoffs from public, anon, authenticated, service_role;

create function private.assert_slug_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.reserved_slugs r where r.slug = new.slug)
     or exists (select 1 from public.reserved_slug_prefixes p where starts_with(new.slug, p.prefix)) then
    raise exception 'slug_reserved' using errcode = '23514';
  end if;
  if exists (select 1 from public.tenant_slug_history h where h.slug = new.slug and h.tenant_id <> new.id) then
    raise exception 'slug_retired' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    insert into public.tenant_slug_history (slug, tenant_id) values (old.slug, old.id)
    on conflict (slug) do nothing;
  end if;
  return new;
end
$$;

create trigger tenants_slug_allowed
  before insert or update of slug on public.tenants
  for each row execute function private.assert_slug_allowed();

create function private.assert_reserved_slug_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants t where t.slug = new.slug) then
    raise exception 'slug_in_use' using errcode = '23514';
  end if;
  return new;
end
$$;

create function private.assert_reserved_prefix_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants t where starts_with(t.slug, new.prefix)) then
    raise exception 'prefix_in_use' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger reserved_slugs_free
  before insert or update on public.reserved_slugs
  for each row execute function private.assert_reserved_slug_free();
create trigger reserved_prefixes_free
  before insert or update on public.reserved_slug_prefixes
  for each row execute function private.assert_reserved_prefix_free();

create function private.owner_regularization_rows()
returns table (slug text, display_name text, status text, reason_code text, action_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.slug,
         t.display_name,
         t.status,
         case t.status when 'past_due' then 'payment_overdue' when 'suspended' then 'subscription_suspended' end,
         'regularize_subscription'
    from public.tenants t
   where t.status in ('past_due', 'suspended')
     and private.has_role(t.id, array['owner'])
   order by t.display_name, t.slug;
$$;
revoke all on function private.owner_regularization_rows() from public, anon, authenticated, service_role, backup_reader;

create function public_api.my_regularization_tenants()
returns table (slug text, display_name text, status text, reason_code text, action_code text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.slug, r.display_name, r.status, r.reason_code, r.action_code
    from private.owner_regularization_rows() r;
$$;
revoke all on function public_api.my_regularization_tenants() from public, anon, service_role, backup_reader;
grant execute on function public_api.my_regularization_tenants() to authenticated;

create function public_api.my_login_tenants()
returns table (slug text, display_name text, role text)
language sql
stable
security definer
set search_path = ''
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

create function server_api.create_login_handoff(
  p_user uuid, p_slug text, p_next text, p_code text, p_sealed bytea
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select t.id into v_tenant
    from public.tenants t
    join public.memberships m on m.tenant_id = t.id
   where t.slug = p_slug
     and t.status in ('trial', 'active')
     and m.user_id = p_user
     and m.status = 'active';
  if v_tenant is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into private.login_handoffs (code_hash, user_id, tenant_id, next_path, sealed, expires_at)
  values (extensions.digest(p_code, 'sha256'), p_user, v_tenant, p_next, p_sealed, now() + interval '60 seconds');
end
$$;

create function server_api.consume_login_handoff(p_slug text, p_code text)
returns table (user_id uuid, next_path text, sealed bytea)
language sql
security definer
set search_path = ''
as $$
  update private.login_handoffs h
     set used_at = now()
    from public.tenants t
   where h.code_hash = extensions.digest(p_code, 'sha256')
     and h.used_at is null
     and h.expires_at > now()
     and t.id = h.tenant_id
     and t.slug = p_slug
     and t.status in ('trial', 'active')
  returning h.user_id, h.next_path, h.sealed;
$$;

revoke all on function server_api.create_login_handoff(uuid, text, text, text, bytea) from public, anon, authenticated, backup_reader;
revoke all on function server_api.consume_login_handoff(text, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.create_login_handoff(uuid, text, text, text, bytea) to service_role;
grant execute on function server_api.consume_login_handoff(text, text) to service_role;

create function server_api.rename_tenant_slug(p_tenant uuid, p_slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenants set slug = p_slug where id = p_tenant;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end
$$;
revoke all on function server_api.rename_tenant_slug(uuid, text) from public, anon, authenticated, backup_reader;
grant execute on function server_api.rename_tenant_slug(uuid, text) to service_role;
insert into public.reserved_slugs (slug, reason) values
  ('app', 'system'),
  ('admin', 'system'),
  ('api', 'system'),
  ('www', 'system'),
  ('mail', 'system'),
  ('smtp', 'system'),
  ('imap', 'system'),
  ('pop', 'system'),
  ('mx', 'system'),
  ('ftp', 'system'),
  ('ns1', 'system'),
  ('ns2', 'system'),
  ('cdn', 'system'),
  ('static', 'system'),
  ('assets', 'system'),
  ('img', 'system'),
  ('media', 'system'),
  ('files', 'system'),
  ('storage', 'system'),
  ('staging', 'system'),
  ('stage', 'system'),
  ('dev', 'system'),
  ('test', 'system'),
  ('demo', 'system'),
  ('sandbox', 'system'),
  ('status', 'system'),
  ('health', 'system'),
  ('docs', 'system'),
  ('help', 'system'),
  ('ajuda', 'system'),
  ('suporte', 'system'),
  ('blog', 'system'),
  ('painel', 'system'),
  ('login', 'system'),
  ('entrar', 'system'),
  ('cadastro', 'system'),
  ('auth', 'system'),
  ('sso', 'system'),
  ('oauth', 'system'),
  ('billing', 'system'),
  ('pagamento', 'system'),
  ('pagamentos', 'system'),
  ('checkout', 'system'),
  ('webhook', 'system'),
  ('webhooks', 'system'),
  ('cron', 'system'),
  ('n8n', 'system'),
  ('traefik', 'system'),
  ('easypanel', 'system'),
  ('supabase', 'system'),
  ('barber', 'system'),
  ('barberclub', 'system'),
  ('workloop', 'system'),
  ('root', 'system'),
  ('superadmin', 'system'),
  ('sistema', 'system'),
  ('conta', 'system'),
  ('minha-conta', 'system'),
  ('pwa', 'system'),
  ('sw', 'system'),
  ('manifest', 'system'),
  ('security', 'system'),
  ('abuse', 'system'),
  ('postmaster', 'system'),
  ('barber-staging', 'system'),
  ('webmail', 'system'),
  ('email', 'system'),
  ('autodiscover', 'system'),
  ('autoconfig', 'system'),
  ('wpad', 'system'),
  ('pop3', 'system'),
  ('sftp', 'system'),
  ('ns', 'system'),
  ('ns3', 'system'),
  ('ns4', 'system'),
  ('dns', 'system'),
  ('www1', 'system'),
  ('www2', 'system'),
  ('www3', 'system'),
  ('localhost', 'system'),
  ('local', 'system'),
  ('internal', 'system'),
  ('intranet', 'system'),
  ('vpn', 'system'),
  ('proxy', 'system'),
  ('gateway', 'system'),
  ('edge', 'system'),
  ('origin', 'system'),
  ('signup', 'system'),
  ('signin', 'system'),
  ('logout', 'system'),
  ('logon', 'system'),
  ('sair', 'system'),
  ('register', 'system'),
  ('registrar', 'system'),
  ('account', 'system'),
  ('password', 'system'),
  ('senha', 'system'),
  ('recuperar', 'system'),
  ('reset', 'system'),
  ('verify', 'system'),
  ('verificar', 'system'),
  ('callback', 'system'),
  ('oauth2', 'system'),
  ('mfa', 'system'),
  ('2fa', 'system'),
  ('otp', 'system'),
  ('token', 'system'),
  ('session', 'system'),
  ('sessao', 'system'),
  ('preview', 'system'),
  ('beta', 'system'),
  ('alpha', 'system'),
  ('null', 'system'),
  ('undefined', 'system'),
  ('true', 'system'),
  ('false', 'system'),
  ('none', 'system'),
  ('nil', 'system'),
  ('nan', 'system'),
  ('git', 'system'),
  ('ci', 'system'),
  ('build', 'system'),
  ('deploy', 'system'),
  ('grafana', 'system'),
  ('metrics', 'system'),
  ('monitor', 'system'),
  ('prometheus', 'system'),
  ('logs', 'system'),
  ('log', 'system'),
  ('backup', 'system'),
  ('backups', 'system'),
  ('db', 'system'),
  ('database', 'system'),
  ('redis', 'system'),
  ('postgres', 'system'),
  ('s3', 'system'),
  ('upload', 'system'),
  ('uploads', 'system'),
  ('download', 'system'),
  ('downloads', 'system'),
  ('public', 'system'),
  ('private', 'system'),
  ('server', 'system'),
  ('ws', 'system'),
  ('wss', 'system'),
  ('socket', 'system'),
  ('realtime', 'system'),
  ('rest', 'system'),
  ('graphql', 'system'),
  ('rpc', 'system'),
  ('functions', 'system'),
  ('studio', 'system'),
  ('kong', 'system'),
  ('termos', 'system'),
  ('privacidade', 'system'),
  ('contato', 'system'),
  ('precos', 'system'),
  ('planos', 'system'),
  ('sobre', 'system'),
  ('landing', 'system'),
  ('site', 'system'),
  ('home', 'system'),
  ('inicio', 'system'),
  ('cliente', 'system'),
  ('clientes', 'system'),
  ('agendar', 'system'),
  ('agenda', 'system'),
  ('reserva', 'system'),
  ('reservas', 'system'),
  ('support', 'system'),
  ('contact', 'system'),
  ('hostmaster', 'system'),
  ('webmaster', 'system'),
  ('noreply', 'system'),
  ('no-reply', 'system'),
  ('info', 'system'),
  ('ssl', 'system'),
  ('tls', 'system'),
  ('acme', 'system'),
  ('well-known', 'system'),
  ('owner', 'system'),
  ('manager', 'system'),
  ('staff', 'system'),
  ('tenant', 'system'),
  ('tenants', 'system'),
  ('hermes', 'system'),
  ('grok', 'system')
on conflict (slug) do nothing;

insert into public.reserved_slug_prefixes (prefix) values
  ('cdn-'),
  ('api-'),
  ('admin-'),
  ('app-'),
  ('mail-'),
  ('static-'),
  ('assets-'),
  ('staging-'),
  ('preview-'),
  ('dev-'),
  ('test-'),
  ('barber-'),
  ('barberclub-'),
  ('workloop-'),
  ('xn--')
on conflict (prefix) do nothing;
