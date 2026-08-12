-- =============================================================================
-- Armonivet · Fix definitivo de tracking + storage
-- Pega TODO este bloque en SQL Editor y dale Run
-- =============================================================================

-- 1) Funciones públicas para registrar visitas/eventos (bypass RLS seguro)
create or replace function public.track_page_visit(
  p_session_id text,
  p_path text default '/',
  p_referrer text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_channel_slug text default 'directo',
  p_user_agent text default null,
  p_device text default null,
  p_landing_path text default null,
  p_is_unique_session boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.page_visits (
    session_id, path, referrer, utm_source, utm_medium, utm_campaign,
    channel_slug, user_agent, device, landing_path, is_unique_session
  ) values (
    p_session_id, coalesce(p_path, '/'), p_referrer, p_utm_source, p_utm_medium, p_utm_campaign,
    coalesce(p_channel_slug, 'directo'), p_user_agent, p_device, p_landing_path, coalesce(p_is_unique_session, false)
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function public.track_conversion(
  p_event_type text,
  p_session_id text default null,
  p_channel_slug text default 'directo',
  p_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into public.conversion_events (
    session_id, event_type, channel_slug, label, metadata
  ) values (
    p_session_id, p_event_type, coalesce(p_channel_slug, 'directo'), p_label, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$$;

revoke all on function public.track_page_visit(text, text, text, text, text, text, text, text, text, text, boolean) from public;
revoke all on function public.track_conversion(text, text, text, text, jsonb) from public;
grant execute on function public.track_page_visit(text, text, text, text, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.track_conversion(text, text, text, text, jsonb) to anon, authenticated;

-- 2) Políticas RLS permisivas de respaldo para inserts directos
alter table public.page_visits enable row level security;
alter table public.conversion_events enable row level security;

drop policy if exists "anon insert visits" on public.page_visits;
drop policy if exists "public insert visits" on public.page_visits;
create policy "public insert visits" on public.page_visits
  for insert
  with check (true);

drop policy if exists "admins read visits" on public.page_visits;
create policy "admins read visits" on public.page_visits
  for select to authenticated
  using (public.is_admin());

drop policy if exists "anon insert conversions" on public.conversion_events;
drop policy if exists "public insert conversions" on public.conversion_events;
create policy "public insert conversions" on public.conversion_events
  for insert
  with check (true);

drop policy if exists "admins read conversions" on public.conversion_events;
create policy "admins read conversions" on public.conversion_events
  for select to authenticated
  using (public.is_admin());

-- 3) Grants explícitos
grant usage on schema public to anon, authenticated;
grant insert on public.page_visits, public.conversion_events to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- 4) Bucket de imágenes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-images',
  'site-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read site images" on storage.objects;
create policy "public read site images" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'site-images');

drop policy if exists "admins upload site images" on storage.objects;
create policy "admins upload site images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins update site images" on storage.objects;
create policy "admins update site images" on storage.objects
  for update to authenticated
  using (bucket_id = 'site-images' and public.is_admin())
  with check (bucket_id = 'site-images' and public.is_admin());

drop policy if exists "admins delete site images" on storage.objects;
create policy "admins delete site images" on storage.objects
  for delete to authenticated
  using (bucket_id = 'site-images' and public.is_admin());

-- 5) Verificación
select 'rpc_ok' as check, proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in ('track_page_visit', 'track_conversion');

select id, name, public from storage.buckets where id = 'site-images';
