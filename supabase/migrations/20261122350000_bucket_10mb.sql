-- Foto de celular passa de 5 MB com facilidade. O redutor no navegador entrega ~150 KB,
-- e este limite e so folga para quando o redutor nao rodar (navegador antigo).
update storage.buckets
   set file_size_limit = 10485760
 where id = 'barberclub-produtos';
