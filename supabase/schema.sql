create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.veiculos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nome_anuncio text not null,
  quilometragem text not null,
  motor text not null,
  valor numeric not null,
  cor text not null,
  fipe text not null default '',
  placa text not null default '',
  texto_anuncio text not null,
  imagens text[] not null default '{}',
  status text not null default 'pendente',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.veiculos add column if not exists fipe text not null default '';
alter table public.veiculos add column if not exists placa text not null default '';
alter table public.veiculos add column if not exists tipo text not null default 'aleatorio';

create table if not exists public.lotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  nome text not null,
  created_at timestamp with time zone default now()
);

alter table public.veiculos add column if not exists lote_id uuid references public.lotes(id) on delete set null;
alter table public.veiculos add column if not exists posicao_lote integer not null default 0;

alter table public.lotes add column if not exists lote_da_vez boolean not null default false;

-- Coluna de admin no perfil
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Tabela global de configuração do timer de disparo (uma única linha, id=1)
create table if not exists public.dispatch_config (
  id integer primary key,
  next_dispatch_at timestamp with time zone not null default (now() + interval '1 hour')
);

-- Garante que a linha inicial existe
insert into public.dispatch_config (id, next_dispatch_at)
values (1, now() + interval '1 hour')
on conflict (id) do nothing;

alter table public.dispatch_config enable row level security;

drop policy if exists "dispatch_config_select_authenticated" on public.dispatch_config;
drop policy if exists "dispatch_config_update_authenticated" on public.dispatch_config;

create policy "dispatch_config_select_authenticated" on public.dispatch_config
  for select using (auth.role() = 'authenticated');

create policy "dispatch_config_update_authenticated" on public.dispatch_config
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

alter table public.lotes enable row level security;

drop policy if exists "lotes_select_authenticated" on public.lotes;
drop policy if exists "lotes_insert_own" on public.lotes;
drop policy if exists "lotes_update_authenticated" on public.lotes;
drop policy if exists "lotes_delete_authenticated" on public.lotes;

create policy "lotes_select_authenticated" on public.lotes
  for select using (auth.role() = 'authenticated');
create policy "lotes_insert_own" on public.lotes
  for insert with check (auth.uid() = user_id);
create policy "lotes_update_authenticated" on public.lotes
  for update using (auth.role() = 'authenticated');
create policy "lotes_delete_authenticated" on public.lotes
  for delete using (auth.role() = 'authenticated');

create table if not exists public.id_dos_grupos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  nome_do_grupo text not null,
  id_do_grupo text null,
  status text not null default 'pendente',
  created_at timestamp with time zone default now()
);

create table if not exists public.anuncio_grupos (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.veiculos(id) on delete cascade,
  grupo_id uuid not null references public.id_dos_grupos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  programado boolean not null default false,
  programado_em timestamp with time zone null,
  created_at timestamp with time zone default now()
);

alter table public.anuncio_grupos
  drop constraint if exists anuncio_grupos_grupo_id_fkey;

alter table public.anuncio_grupos
  add constraint anuncio_grupos_grupo_id_fkey
  foreign key (grupo_id) references public.id_dos_grupos(id) on delete cascade;

alter table public.profiles enable row level security;
alter table public.veiculos enable row level security;
alter table public.id_dos_grupos enable row level security;
alter table public.anuncio_grupos enable row level security;

alter table public.veiculos alter column status set default 'pendente';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_veiculos_updated_at on public.veiculos;

create trigger touch_veiculos_updated_at
  before update on public.veiculos
  for each row execute procedure public.touch_updated_at();

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "veiculos_select_own" on public.veiculos;
drop policy if exists "veiculos_select_authenticated" on public.veiculos;
drop policy if exists "veiculos_insert_own" on public.veiculos;
drop policy if exists "veiculos_update_own" on public.veiculos;
drop policy if exists "veiculos_update_authenticated" on public.veiculos;
drop policy if exists "veiculos_delete_own" on public.veiculos;
drop policy if exists "veiculos_delete_authenticated" on public.veiculos;

create policy "veiculos_select_authenticated"
  on public.veiculos for select
  using (auth.role() = 'authenticated');

create policy "veiculos_insert_own"
  on public.veiculos for insert
  with check (auth.uid() = user_id);

create policy "veiculos_update_authenticated"
  on public.veiculos for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "veiculos_delete_authenticated"
  on public.veiculos for delete
  using (auth.role() = 'authenticated');

drop policy if exists "id_dos_grupos_select_own" on public.id_dos_grupos;
drop policy if exists "id_dos_grupos_select_authenticated" on public.id_dos_grupos;
drop policy if exists "id_dos_grupos_insert_own" on public.id_dos_grupos;
drop policy if exists "id_dos_grupos_update_own" on public.id_dos_grupos;
drop policy if exists "id_dos_grupos_delete_own" on public.id_dos_grupos;
drop policy if exists "id_dos_grupos_delete_authenticated" on public.id_dos_grupos;

create policy "id_dos_grupos_select_authenticated"
  on public.id_dos_grupos for select
  using (auth.role() = 'authenticated');

create policy "id_dos_grupos_insert_own"
  on public.id_dos_grupos for insert
  with check (auth.uid() = user_id);

create policy "id_dos_grupos_update_own"
  on public.id_dos_grupos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "id_dos_grupos_delete_authenticated"
  on public.id_dos_grupos for delete
  using (auth.role() = 'authenticated');

drop policy if exists "anuncio_grupos_select_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_select_authenticated" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_insert_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_insert_authenticated" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_update_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_update_authenticated" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_delete_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_delete_authenticated" on public.anuncio_grupos;

create policy "anuncio_grupos_select_authenticated"
  on public.anuncio_grupos for select
  using (auth.role() = 'authenticated');

create policy "anuncio_grupos_insert_authenticated"
  on public.anuncio_grupos for insert
  with check (
    auth.role() = 'authenticated'
    and exists (
      select 1 from public.veiculos
      where veiculos.id = anuncio_grupos.veiculo_id
    )
    and exists (
      select 1 from public.id_dos_grupos
      where id_dos_grupos.id = anuncio_grupos.grupo_id
    )
  );

create policy "anuncio_grupos_update_authenticated"
  on public.anuncio_grupos for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "anuncio_grupos_delete_authenticated"
  on public.anuncio_grupos for delete
  using (auth.role() = 'authenticated');

insert into storage.buckets (id, name, public)
values ('veiculos-imagens', 'veiculos-imagens', true)
on conflict (id) do update set public = true;

drop policy if exists "storage_select_public_veiculos" on storage.objects;
drop policy if exists "storage_insert_own_veiculos" on storage.objects;
drop policy if exists "storage_update_own_veiculos" on storage.objects;
drop policy if exists "storage_delete_own_veiculos" on storage.objects;

create policy "storage_select_public_veiculos"
  on storage.objects for select
  using (bucket_id = 'veiculos-imagens');

create policy "storage_insert_own_veiculos"
  on storage.objects for insert
  with check (
    bucket_id = 'veiculos-imagens'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "storage_update_own_veiculos"
  on storage.objects for update
  using (
    bucket_id = 'veiculos-imagens'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'veiculos-imagens'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "storage_delete_own_veiculos"
  on storage.objects for delete
  using (
    bucket_id = 'veiculos-imagens'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ---------------------------------------------------------------------------
-- Tabela de instâncias WhatsApp (UAZAPI)
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_instancias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  nome text not null,
  token text not null,
  status text not null default 'desconectado',
  created_at timestamp with time zone default now()
);

alter table public.whatsapp_instancias enable row level security;

drop policy if exists "wapp_select_authenticated" on public.whatsapp_instancias;
drop policy if exists "wapp_insert_own" on public.whatsapp_instancias;
drop policy if exists "wapp_update_authenticated" on public.whatsapp_instancias;
drop policy if exists "wapp_delete_authenticated" on public.whatsapp_instancias;

create policy "wapp_select_authenticated"
  on public.whatsapp_instancias for select
  using (auth.role() = 'authenticated');

create policy "wapp_insert_own"
  on public.whatsapp_instancias for insert
  with check (auth.uid() = user_id);

create policy "wapp_update_authenticated"
  on public.whatsapp_instancias for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy "wapp_delete_authenticated"
  on public.whatsapp_instancias for delete
  using (auth.role() = 'authenticated');
