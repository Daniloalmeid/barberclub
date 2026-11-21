-- Diagnóstico read-only do passo 1 da M2. Não altera dados.
-- O Hermes roda, com autorização do Danilo, e registra só a contagem no log.
begin transaction read only;
select count(*)                                                   as total,
       count(*) filter (where length(slug) < 3)                   as curtos,
       count(*) filter (where length(slug) > 32)                  as longos,
       count(*) filter (where position('--' in slug) > 0)         as hifen_duplo,
       count(*) filter (where not (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$'
                                   and position('--' in slug) = 0)) as fora_da_regra
  from public.tenants;
rollback;
