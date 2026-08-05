-- Garante no banco que todo anuncio novo seja vinculado aos grupos validos.
-- A regra deixa de depender exclusivamente da aplicacao, evitando veiculos
-- salvos sem grupo quando a segunda requisicao falhar ou uma versao antiga
-- da aplicacao ainda estiver em execucao.

create or replace function public.auto_link_vehicle_to_groups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.anuncio_grupos (
    veiculo_id,
    grupo_id,
    user_id,
    programado
  )
  select
    new.id,
    grupo.id,
    new.user_id,
    false
  from public.id_dos_grupos as grupo
  where grupo.id_do_grupo is not null
    and btrim(grupo.id_do_grupo) <> ''
  on conflict (veiculo_id, grupo_id) do nothing;

  return new;
end;
$$;

drop trigger if exists auto_link_vehicle_to_groups on public.veiculos;

create trigger auto_link_vehicle_to_groups
  after insert on public.veiculos
  for each row execute function public.auto_link_vehicle_to_groups();

-- Repara anuncios existentes que ficaram sem algum dos vinculos esperados,
-- incluindo cadastros feitos antes desta garantia existir.
insert into public.anuncio_grupos (
  veiculo_id,
  grupo_id,
  user_id,
  programado
)
select
  veiculo.id,
  grupo.id,
  veiculo.user_id,
  false
from public.veiculos as veiculo
cross join public.id_dos_grupos as grupo
where grupo.id_do_grupo is not null
  and btrim(grupo.id_do_grupo) <> ''
on conflict (veiculo_id, grupo_id) do nothing;
