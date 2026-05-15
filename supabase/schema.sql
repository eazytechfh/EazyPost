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
  texto_anuncio text not null,
  imagens text[] not null default '{}',
  status text not null default 'pendente',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.grupos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  nome text not null,
  link text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.anuncio_grupos (
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.veiculos(id) on delete cascade,
  grupo_id uuid not null references public.grupos(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  programado boolean not null default false,
  programado_em timestamp with time zone null,
  created_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;
alter table public.veiculos enable row level security;
alter table public.grupos enable row level security;
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
drop policy if exists "veiculos_insert_own" on public.veiculos;
drop policy if exists "veiculos_update_own" on public.veiculos;
drop policy if exists "veiculos_delete_own" on public.veiculos;

create policy "veiculos_select_own"
  on public.veiculos for select
  using (auth.uid() = user_id);

create policy "veiculos_insert_own"
  on public.veiculos for insert
  with check (auth.uid() = user_id);

create policy "veiculos_update_own"
  on public.veiculos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "veiculos_delete_own"
  on public.veiculos for delete
  using (auth.uid() = user_id);

drop policy if exists "grupos_select_own" on public.grupos;
drop policy if exists "grupos_insert_own" on public.grupos;
drop policy if exists "grupos_update_own" on public.grupos;
drop policy if exists "grupos_delete_own" on public.grupos;

create policy "grupos_select_own"
  on public.grupos for select
  using (auth.uid() = user_id);

create policy "grupos_insert_own"
  on public.grupos for insert
  with check (auth.uid() = user_id);

create policy "grupos_update_own"
  on public.grupos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "grupos_delete_own"
  on public.grupos for delete
  using (auth.uid() = user_id);

drop policy if exists "anuncio_grupos_select_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_insert_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_update_own" on public.anuncio_grupos;
drop policy if exists "anuncio_grupos_delete_own" on public.anuncio_grupos;

create policy "anuncio_grupos_select_own"
  on public.anuncio_grupos for select
  using (auth.uid() = user_id);

create policy "anuncio_grupos_insert_own"
  on public.anuncio_grupos for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.veiculos
      where veiculos.id = anuncio_grupos.veiculo_id
        and veiculos.user_id = auth.uid()
    )
    and exists (
      select 1 from public.grupos
      where grupos.id = anuncio_grupos.grupo_id
        and grupos.user_id = auth.uid()
    )
  );

create policy "anuncio_grupos_update_own"
  on public.anuncio_grupos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "anuncio_grupos_delete_own"
  on public.anuncio_grupos for delete
  using (auth.uid() = user_id);

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
