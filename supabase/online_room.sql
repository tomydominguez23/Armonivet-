-- =============================================================================
-- Armonivet · Sala fija de Google Meet para consultas online
-- SQL Editor, en cualquier momento.
--
-- El link vive en site_settings.online_room y solo lo leen el panel (admin)
-- y las Edge Functions. La web pública no puede verlo.
-- =============================================================================

drop policy if exists "public read settings" on public.site_settings;
create policy "public read settings" on public.site_settings
  for select to anon, authenticated
  using (key is distinct from 'online_room');
