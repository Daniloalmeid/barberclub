-- Reversão: drop schema ledger cascade; recriar vazio com authorization ledger_owner
-- se as migrations anteriores ainda estiverem aplicadas.

create table ledger.accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'revenue', 'contra_revenue', 'expense')),
  staff_id uuid,
  unique (tenant_id, id),
  unique (tenant_id, code)
);

create table ledger.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  occurred_at timestamptz not null,
  kind text not null check (kind in (
    'payment', 'payment_unallocated', 'gateway_fee', 'settlement',
    'commission', 'commission_payout', 'refund', 'platform_fee', 'reversal'
  )),
  source_type text not null,
  source_id uuid not null,
  reverses_entry_id uuid,
  memo text,
  created_by uuid,
  prev_hash bytea,
  entry_hash bytea not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, source_type, source_id, kind),
  unique (reverses_entry_id),
  foreign key (tenant_id, reverses_entry_id) references ledger.journal_entries (tenant_id, id)
);

create table ledger.journal_lines (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  entry_id uuid not null,
  account_id uuid not null,
  debit_cents bigint not null default 0 check (debit_cents >= 0),
  credit_cents bigint not null default 0 check (credit_cents >= 0),
  check ((debit_cents > 0) <> (credit_cents > 0)),
  foreign key (tenant_id, entry_id) references ledger.journal_entries (tenant_id, id),
  foreign key (tenant_id, account_id) references ledger.accounts (tenant_id, id)
);

alter table ledger.accounts owner to ledger_owner;
alter table ledger.journal_entries owner to ledger_owner;
alter table ledger.journal_lines owner to ledger_owner;

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'ledger'
       and c.relkind = 'S'
  loop
    execute format('alter sequence ledger.%I owner to ledger_owner', r.relname);
  end loop;
end
$$;
