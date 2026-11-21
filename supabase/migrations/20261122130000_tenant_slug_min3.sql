-- Slug de 3 a 32 caracteres. Conta os fora da regra e aborta só com a contagem.
-- Não renomeia nem apaga. Reversão no comentário de docs/m4-arquitetura.md §2.3.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

lock table public.tenants in access exclusive mode;

do $$
declare
  v_fora bigint;
begin
  select count(*) into v_fora
    from public.tenants
   where not (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' and position('--' in slug) = 0);
  if v_fora > 0 then
    raise exception 'tenants_slug_shape: % slug(s) fora da regra de 3 a 32 caracteres; migration abortada sem alterar dados', v_fora
      using errcode = '23514',
            hint = 'Rode a query de diagnóstico read-only do doc M4 §2.3; corrija os slugs com autorização do Danilo e reaplique.';
  end if;
end
$$;

alter table public.tenants
  drop constraint tenants_slug_shape,
  add constraint tenants_slug_shape check (
    slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
    and position('--' in slug) = 0
  );
