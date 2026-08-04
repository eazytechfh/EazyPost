-- Remove vinculos repetidos, conservando o registro mais antigo.
with vinculos_duplicados as (
  select
    id,
    row_number() over (
      partition by veiculo_id, grupo_id
      order by created_at asc nulls first, id asc
    ) as numero
  from public.anuncio_grupos
)
delete from public.anuncio_grupos
using vinculos_duplicados
where public.anuncio_grupos.id = vinculos_duplicados.id
  and vinculos_duplicados.numero > 1;

-- Impede definitivamente mais de um vinculo do mesmo grupo por veiculo.
alter table public.anuncio_grupos
  add constraint anuncio_grupos_veiculo_grupo_key unique (veiculo_id, grupo_id);
