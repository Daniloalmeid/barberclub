-- Reversão: drop function ledger.post_journal_entry, ledger.reverse_journal_entry
-- e os triggers de imutabilidade e de soma zero.

create or replace function ledger.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ledger is immutable' using errcode = '42501';
end
$$;

create or replace function ledger.trg_lines_balanced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_debit bigint;
  v_credit bigint;
begin
  select count(*), coalesce(sum(l.debit_cents), 0), coalesce(sum(l.credit_cents), 0)
    into v_count, v_debit, v_credit
    from ledger.journal_lines l
   where l.entry_id = new.entry_id;
  if v_count < 2 or v_debit <> v_credit then
    raise exception 'journal entry is not balanced' using errcode = '23514';
  end if;
  return null;
end
$$;

create or replace function ledger.trg_entry_has_lines()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_debit bigint;
  v_credit bigint;
begin
  select count(*), coalesce(sum(l.debit_cents), 0), coalesce(sum(l.credit_cents), 0)
    into v_count, v_debit, v_credit
    from ledger.journal_lines l
   where l.entry_id = new.id;
  if v_count < 2 or v_debit <> v_credit then
    raise exception 'journal entry is not balanced' using errcode = '23514';
  end if;
  return null;
end
$$;

create constraint trigger journal_lines_balanced
  after insert on ledger.journal_lines
  deferrable initially deferred
  for each row
  execute function ledger.trg_lines_balanced();

create constraint trigger journal_entries_has_lines
  after insert on ledger.journal_entries
  deferrable initially deferred
  for each row
  execute function ledger.trg_entry_has_lines();

create trigger journal_entries_no_update_delete
  before update or delete on ledger.journal_entries
  for each row
  execute function ledger.forbid_mutation();

create trigger journal_lines_no_update_delete
  before update or delete on ledger.journal_lines
  for each row
  execute function ledger.forbid_mutation();

create trigger journal_entries_no_truncate
  before truncate on ledger.journal_entries
  for each statement
  execute function ledger.forbid_mutation();

create trigger journal_lines_no_truncate
  before truncate on ledger.journal_lines
  for each statement
  execute function ledger.forbid_mutation();

create trigger accounts_tenant_immutable
  before update of tenant_id on ledger.accounts
  for each row
  execute function private.forbid_tenant_change();

create trigger journal_entries_tenant_immutable
  before update of tenant_id on ledger.journal_entries
  for each row
  execute function private.forbid_tenant_change();

create trigger journal_lines_tenant_immutable
  before update of tenant_id on ledger.journal_lines
  for each row
  execute function private.forbid_tenant_change();

create or replace function ledger.post_journal_entry(
  p_tenant uuid,
  p_kind text,
  p_source_type text,
  p_source_id uuid,
  p_occurred_at timestamptz,
  p_lines jsonb,
  p_memo text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry uuid;
  v_prev bytea;
  v_hash bytea;
  v_canonical text;
  v_line jsonb;
  v_account uuid;
  v_debit bigint;
  v_credit bigint;
  v_sum_d bigint := 0;
  v_sum_c bigint := 0;
  v_n integer := 0;
  v_reverses uuid;
begin
  if p_kind not in (
    'payment', 'payment_unallocated', 'gateway_fee', 'settlement',
    'commission', 'commission_payout', 'refund', 'platform_fee', 'reversal'
  ) then
    raise exception 'invalid journal kind' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ledger:' || p_tenant::text, 0));

  v_canonical := concat_ws(
    '|',
    p_tenant::text,
    p_kind,
    p_source_type,
    p_source_id::text,
    to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    coalesce(p_memo, '')
  );

  for v_line in select value from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb))
  loop
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if (v_debit > 0) = (v_credit > 0) or v_debit < 0 or v_credit < 0 then
      raise exception 'line must be debit xor credit' using errcode = '23514';
    end if;
    if v_line ? 'account_id' then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      select a.id into v_account
        from ledger.accounts a
       where a.tenant_id = p_tenant
         and a.code = v_line ->> 'code';
      if v_account is null then
        raise exception 'unknown account' using errcode = '23503';
      end if;
    end if;
    v_sum_d := v_sum_d + v_debit;
    v_sum_c := v_sum_c + v_credit;
    v_n := v_n + 1;
    v_canonical := v_canonical || '|' || v_account::text || ':' || v_debit::text || ':' || v_credit::text;
  end loop;

  if v_n < 2 or v_sum_d <> v_sum_c then
    raise exception 'journal entry is not balanced' using errcode = '23514';
  end if;

  select e.entry_hash into v_prev
    from ledger.journal_entries e
   where e.tenant_id = p_tenant
   order by e.created_at desc, e.id desc
   limit 1;

  v_hash := extensions.digest(
    coalesce(v_prev, ''::bytea) || convert_to(v_canonical, 'UTF8'),
    'sha256'
  );

  v_reverses := nullif(current_setting('barberclub.reverses_entry', true), '')::uuid;

  insert into ledger.journal_entries (
    tenant_id, occurred_at, kind, source_type, source_id,
    reverses_entry_id, memo, created_by, prev_hash, entry_hash
  ) values (
    p_tenant, p_occurred_at, p_kind, p_source_type, p_source_id,
    v_reverses,
    p_memo,
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid,
    v_prev,
    v_hash
  )
  returning id into v_entry;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_debit := coalesce((v_line ->> 'debit_cents')::bigint, 0);
    v_credit := coalesce((v_line ->> 'credit_cents')::bigint, 0);
    if v_line ? 'account_id' then
      v_account := (v_line ->> 'account_id')::uuid;
    else
      select a.id into v_account
        from ledger.accounts a
       where a.tenant_id = p_tenant
         and a.code = v_line ->> 'code';
    end if;
    insert into ledger.journal_lines (tenant_id, entry_id, account_id, debit_cents, credit_cents)
    values (p_tenant, v_entry, v_account, v_debit, v_credit);
  end loop;

  return v_entry;
end
$$;

create or replace function ledger.reverse_journal_entry(p_entry uuid, p_memo text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src ledger.journal_entries%rowtype;
  v_lines jsonb;
  v_id uuid;
begin
  select * into v_src from ledger.journal_entries where id = p_entry;
  if not found then
    raise exception 'entry not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from ledger.journal_entries e where e.reverses_entry_id = p_entry
  ) then
    raise exception 'entry already reversed' using errcode = '23505';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account_id', l.account_id,
    'debit_cents', l.credit_cents,
    'credit_cents', l.debit_cents
  ) order by l.id)
    into v_lines
    from ledger.journal_lines l
   where l.entry_id = p_entry;

  perform set_config('barberclub.reverses_entry', p_entry::text, true);
  v_id := ledger.post_journal_entry(
    v_src.tenant_id,
    'reversal',
    'journal_entry',
    p_entry,
    now(),
    v_lines,
    p_memo
  );
  perform set_config('barberclub.reverses_entry', '', true);
  return v_id;
end
$$;

alter function ledger.forbid_mutation() owner to ledger_owner;
alter function ledger.trg_lines_balanced() owner to ledger_owner;
alter function ledger.trg_entry_has_lines() owner to ledger_owner;
alter function ledger.post_journal_entry(uuid, text, text, uuid, timestamptz, jsonb, text) owner to ledger_owner;
alter function ledger.reverse_journal_entry(uuid, text) owner to ledger_owner;

revoke all on function ledger.forbid_mutation() from public, anon, authenticated, service_role, backup_reader;
revoke all on function ledger.trg_lines_balanced() from public, anon, authenticated, service_role, backup_reader;
revoke all on function ledger.trg_entry_has_lines() from public, anon, authenticated, service_role, backup_reader;
revoke all on function ledger.post_journal_entry(uuid, text, text, uuid, timestamptz, jsonb, text)
  from public, anon, authenticated, service_role, backup_reader;
revoke all on function ledger.reverse_journal_entry(uuid, text)
  from public, anon, authenticated, service_role, backup_reader;

grant execute on function ledger.post_journal_entry(uuid, text, text, uuid, timestamptz, jsonb, text) to postgres;
grant execute on function ledger.reverse_journal_entry(uuid, text) to postgres;
grant execute on function private.forbid_tenant_change() to ledger_owner;
grant usage on schema extensions to ledger_owner;
grant execute on all functions in schema extensions to ledger_owner;
