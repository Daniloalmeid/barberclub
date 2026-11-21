-- Reversão: drop table das tabelas de public criadas aqui, em ordem inversa de FK.
-- Papéis, schemas e ledger ficam nas migrations vizinhas.

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  status text not null check (status in ('trial', 'active', 'past_due', 'suspended')),
  timezone text not null default 'America/Sao_Paulo',
  document_number text,
  owner_email text,
  created_at timestamptz not null default now(),
  constraint tenants_slug_shape check (
    slug ~ '^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])?$'
    and slug !~ '--'
    and slug !~ '^xn--'
  )
);

create table public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  domain text not null unique,
  unique (tenant_id, id)
);

create table public.tenant_branding (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  logo_url text,
  banner_urls jsonb not null default '[]'::jsonb,
  color_primary text,
  color_secondary text,
  color_accent text,
  address_line text,
  city text,
  state text,
  phone_public text,
  whatsapp_public text,
  instagram_handle text,
  opening_hours jsonb not null default '[]'::jsonb,
  booking_policy_text text
);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  min_advance_minutes integer not null default 0 check (min_advance_minutes >= 0),
  hold_minutes integer not null default 10 check (hold_minutes > 0),
  slot_step_minutes integer not null default 30 check (slot_step_minutes > 0),
  -- D4: pagar no local é o padrão. PIX opcional fica desligado até a M6.
  payment_mode text not null default 'pay_at_location'
    check (payment_mode in ('pay_at_location', 'pix_optional')),
  pix_enabled boolean not null default false,
  cancel_refund_policy text not null default 'refund_if_paid'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  full_name text,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  -- D5: manager existe no schema desde a M1; a tela de convite é da M7.
  role text not null check (role in ('owner', 'manager', 'staff')),
  status text not null default 'active' check (status in ('active', 'invited', 'revoked')),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  price_cents bigint not null check (price_cents >= 0)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  plan_id uuid not null references public.plans (id),
  status text not null check (status in ('trial', 'active', 'past_due', 'suspended', 'canceled')),
  grace_until timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  -- D3: uma identidade em auth.users e uma linha de customer por tenant.
  user_id uuid not null references auth.users (id) on delete restrict,
  full_name text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid references auth.users (id),
  display_name text not null,
  active boolean not null default true,
  photo_url text,
  short_bio text,
  commission_bps integer not null default 0 check (commission_bps between 0 and 10000),
  unique (tenant_id, id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  name text not null,
  description text,
  duration_min integer not null check (duration_min > 0),
  buffer_min integer not null default 0 check (buffer_min >= 0),
  price_cents bigint not null check (price_cents >= 0),
  category text,
  display_order integer not null default 0,
  active boolean not null default true,
  commission_bps integer,
  unique (tenant_id, id)
);

create table public.staff_services (
  tenant_id uuid not null,
  staff_id uuid not null,
  service_id uuid not null,
  active boolean not null default true,
  primary key (tenant_id, staff_id, service_id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id)
);

create table public.work_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  staff_id uuid not null,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  unique (tenant_id, id),
  unique (tenant_id, staff_id, weekday),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id)
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  staff_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  reason text,
  check (ends_at > starts_at),
  unique (tenant_id, id),
  unique (tenant_id, id, staff_id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id)
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  staff_id uuid not null,
  customer_id uuid not null,
  service_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in (
    'hold', 'pending_payment', 'confirmed', 'completed',
    'canceled', 'no_show', 'expired', 'payment_conflict'
  )),
  hold_expires_at timestamptz,
  idempotency_key text not null,
  request_hash bytea not null,
  price_cents bigint,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (tenant_id, id),
  unique (tenant_id, id, staff_id),
  unique (tenant_id, customer_id, idempotency_key),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id),
  foreign key (tenant_id, staff_id, service_id)
    references public.staff_services (tenant_id, staff_id, service_id)
);

create table public.staff_busy (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  staff_id uuid not null,
  period tstzrange not null,
  appointment_id uuid,
  time_off_id uuid,
  active boolean not null default true,
  check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  check (num_nonnulls(appointment_id, time_off_id) = 1),
  unique (appointment_id),
  unique (time_off_id),
  foreign key (tenant_id, staff_id) references public.staff (tenant_id, id),
  foreign key (tenant_id, appointment_id, staff_id)
    references public.appointments (tenant_id, id, staff_id)
    deferrable initially deferred,
  foreign key (tenant_id, time_off_id, staff_id)
    references public.time_off (tenant_id, id, staff_id)
    deferrable initially deferred,
  constraint staff_busy_no_overlap exclude using gist (
    tenant_id with =,
    staff_id with =,
    period with &&
  ) where (active)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  appointment_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  status text not null check (status in (
    'pending', 'paid', 'paid_unallocated', 'refund_pending', 'refunded', 'failed'
  )),
  provider text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, appointment_id) references public.appointments (tenant_id, id)
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  payment_id uuid not null references public.payments (id) on delete restrict,
  amount_cents bigint not null check (amount_cents >= 0),
  status text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  payment_id uuid not null unique references public.payments (id) on delete restrict,
  reason text not null,
  status text not null check (status in ('pending', 'processing', 'done', 'failed')),
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);

create table public.admin_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  kind text not null,
  ref_id uuid,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  payment_id uuid,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants (id) on delete restrict,
  user_id uuid,
  action text not null,
  entity text,
  request_id text,
  client_ip_unverified text,
  ip_trusted boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  type text not null,
  ref_id uuid,
  created_at timestamptz not null default now()
);

create table public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (bucket, window_start)
);
