-- Slug de 3 a 32 caracteres. Um único bloco: o CLI do Supabase não abre transação,
-- e LOCK TABLE fora de transação falha. Não renomeia nem apaga.
-- Reversão no comentário de docs/m4-arquitetura.md §2.3.
do $$
declare
  v_fora bigint;
begin
  perform set_config('lock_timeout', '2s', true);
  lock table public.tenants in access exclusive mode;
  select count(*) into v_fora
    from public.tenants
   where not (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' and position('--' in slug) = 0);
  if v_fora > 0 then
    raise exception 'tenants_slug_shape: % slug(s) fora da regra de 3 a 32 caracteres; migration abortada sem alterar dados', v_fora
      using errcode = '23514',
            hint = 'Rode a query de diagnóstico read-only do doc M4 §2.3; corrija os slugs com autorização do Danilo e reaplique.';
  end if;
  alter table public.tenants
    drop constraint tenants_slug_shape,
    add constraint tenants_slug_shape check (
      slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
      and position('--' in slug) = 0
    );
end
$$;
