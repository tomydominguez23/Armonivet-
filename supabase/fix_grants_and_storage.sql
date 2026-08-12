-- =============================================================================
-- Armonivet · Fix rápido: grants + RLS tracking + bucket de imágenes
-- Ejecutar una vez en SQL Editor (después de schema/seed/rpc)
-- =============================================================================

-- Permisos base para anon/authenticated
grant usage on schema public to anon, authenticated;

grant select on public.services, public.ad_channels, public.pricing_zones,
  public.price_extras, public.site_media, public.site_settings
  to anon, authenticated;

grant insert on public.page_visits, public.conversion_events
  to anon, authenticated;

grant select, insert, update, delete on public.page_visits, public.conversion_events,
  public.appointments, public.services, public.ad_channels, public.pricing_zones,
  public.price_extras, public.site_media, public.site_settings, public.profiles
  to authenticated;

-- Recrear políticas de tracking (por si no quedaron aplicadas)
drop policy if exists "anon insert visits" on public.page_visits;
create policy "anon insert visits" on public.page_visits
  for insert to anon, authenticated
  with check (true);

drop policy if exists "admins read visits" on public.page_visits;
create policy "admins read visits" on public.page_visits
  for select to authenticated
  using (public.is_admin());

drop policy if exists "anon insert conversions" on public.conversion_events;
create policy "anon insert conversions" on public.conversion_events
  for insert to anon, authenticated
  with check (true);

drop policy if exists "admins read conversions" on public.conversion_events;
create policy "admins read conversions" on public.conversion_events
  for select to authenticated
  using (public.is_admin());

drop policy if exists "admins manage conversions" on public.conversion_events;
create policy "admins manage conversions" on public.conversion_events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Bucket de imágenes del sitio
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do update set public = true;

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

-- Smoke checks (deben devolver true / filas)
select
  has_table_privilege('anon', 'public.page_visits', 'insert') as anon_can_insert_visits,
  has_table_privilege('anon', 'public.services', 'select') as anon_can_read_services;

select id, name, public from storage.buckets where id = 'site-images';
