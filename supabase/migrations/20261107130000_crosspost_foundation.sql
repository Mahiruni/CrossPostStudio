create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','linkedin','tiktok','youtube')),
  provider_account_id text not null,
  account_name text not null,
  status text not null default 'connected' check (status in ('connected','expired','revoked','error')),
  scopes text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_account_id)
);

create table if not exists private.social_credentials (
  social_account_id uuid primary key references public.social_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  access_token_iv text not null,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  post_type text not null check (post_type in ('video','image','text')),
  caption text not null default '',
  source_url text not null default '',
  media_path text,
  file_name text,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  status text not null default 'draft' check (status in ('draft','queued','publishing','partial','published','failed')),
  planned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.post_destinations (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  provider text not null check (provider in ('facebook','instagram','linkedin','tiktok','youtube')),
  status text not null default 'queued' check (status in ('queued','uploading','processing','published','paused','review','failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  stage text not null default '',
  remote_id text,
  remote_url text,
  publish_state jsonb not null default '{}'::jsonb,
  error text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (post_id, social_account_id)
);

alter table public.profiles enable row level security;
alter table public.social_accounts enable row level security;
alter table public.posts enable row level security;
alter table public.post_destinations enable row level security;
alter table private.social_credentials enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.social_accounts, public.posts, public.post_destinations to authenticated;
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create policy "profiles_owner_all" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "social_accounts_owner_all" on public.social_accounts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "posts_owner_all" on public.posts for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "post_destinations_owner_all" on public.post_destinations for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crosspost-media', 'crosspost-media', false, 52428800, array['video/mp4','video/quicktime','video/webm','image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "media_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'crosspost-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'crosspost-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_owner_update" on storage.objects for update to authenticated
  using (bucket_id = 'crosspost-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'crosspost-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "media_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'crosspost-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
