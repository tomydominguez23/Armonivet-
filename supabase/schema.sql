-- =============================================================================
-- Armonivet · Schema completo para Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- Orden: 1) schema.sql  2) seed.sql  3) (opcional) create admin user en Auth
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Perfiles de administración (vinculados a auth.users)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'admin' check (role in ('admin', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'staff')
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'admin')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Canales de publicidad / atribución
-- -----------------------------------------------------------------------------
create table if not exists public.ad_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  color text default '#2f6f84',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.ad_channels enable row level security;

-- -----------------------------------------------------------------------------
-- Visitas a la web
-- -----------------------------------------------------------------------------
create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  path text not null default '/',
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  channel_slug text,
  user_agent text,
  device text,
  landing_path text,
  is_unique_session boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists page_visits_created_at_idx on public.page_visits (created_at desc);
create index if not exists page_visits_session_idx on public.page_visits (session_id);
create index if not exists page_visits_channel_idx on public.page_visits (channel_slug);

alter table public.page_visits enable row level security;

-- -----------------------------------------------------------------------------
-- Eventos de conversión (clics, agendas, compras)
-- -----------------------------------------------------------------------------
create table if not exists public.conversion_events (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  event_type text not null check (
    event_type in (
      'page_view',
      'click_agendar',
      'click_formulario',
      'click_instagram',
      'appointment_booked',
      'payment_confirmed',
      'arrived',
      'completed'
    )
  ),
  channel_slug text,
  label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversion_events_type_idx on public.conversion_events (event_type, created_at desc);
create index if not exists conversion_events_channel_idx on public.conversion_events (channel_slug);

alter table public.conversion_events enable row level security;

-- -----------------------------------------------------------------------------
-- Citas / agenda operativa
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null,
  client_email text,
  client_phone text,
  pet_name text,
  pet_type text,
  service_title text,
  zone text,
  scheduled_at timestamptz,
  status text not null default 'agendada'
    check (status in ('agendada', 'abonada', 'llegó', 'completada', 'cancelada', 'no_asistió')),
  amount integer default 0,
  deposit_amount integer default 20000,
  deposit_paid boolean not null default false,
  channel_slug text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_status_idx on public.appointments (status);
create index if not exists appointments_scheduled_idx on public.appointments (scheduled_at);

alter table public.appointments enable row level security;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch
  before update on public.appointments
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Servicios editables (reflejan la web)
-- -----------------------------------------------------------------------------
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  price_from integer,
  price_label text,
  image_url text,
  tag text,
  calendly_url text default 'https://calendly.com/armonivet/consulta-etologia-clinica',
  sort_order integer not null default 0,
  active boolean not null default true,
  section text not null default 'servicios'
    check (section in ('servicios', 'ofertas', 'ambos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists services_touch on public.services;
create trigger services_touch
  before update on public.services
  for each row execute function public.touch_updated_at();

alter table public.services enable row level security;

-- -----------------------------------------------------------------------------
-- Zonas / precios
-- -----------------------------------------------------------------------------
create table if not exists public.pricing_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  badge text,
  price integer not null,
  zones_text text,
  image_url text,
  map_embed_url text,
  featured boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists pricing_zones_touch on public.pricing_zones;
create trigger pricing_zones_touch
  before update on public.pricing_zones
  for each row execute function public.touch_updated_at();

alter table public.pricing_zones enable row level security;

create table if not exists public.price_extras (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  amount integer not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

alter table public.price_extras enable row level security;

-- -----------------------------------------------------------------------------
-- Medios / imágenes de la web (slots editables)
-- -----------------------------------------------------------------------------
create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  slot text not null unique,
  title text,
  url text not null,
  alt_text text,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_media_touch on public.site_media;
create trigger site_media_touch
  before update on public.site_media
  for each row execute function public.touch_updated_at();

alter table public.site_media enable row level security;

-- -----------------------------------------------------------------------------
-- Ajustes generales del negocio
-- -----------------------------------------------------------------------------
create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch
  before update on public.site_settings
  for each row execute function public.touch_updated_at();

alter table public.site_settings enable row level security;

-- -----------------------------------------------------------------------------
-- Vista de métricas diarias (para el dashboard)
-- -----------------------------------------------------------------------------
create or replace view public.daily_stats as
select
  date_trunc('day', created_at)::date as day,
  count(*) filter (where is_unique_session) as unique_visits,
  count(*) as page_hits
from public.page_visits
group by 1
order by 1 desc;

create or replace view public.channel_stats as
select
  coalesce(nullif(channel_slug, ''), 'directo') as channel_slug,
  count(*) filter (where is_unique_session) as unique_visits,
  count(*) as page_hits
from public.page_visits
group by 1
order by unique_visits desc;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

-- profiles
drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles
  for select to authenticated using (public.is_admin());

drop policy if exists "admins update own profile" on public.profiles;
create policy "admins update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- ad_channels
drop policy if exists "public read channels" on public.ad_channels;
create policy "public read channels" on public.ad_channels
  for select to anon, authenticated using (active = true or public.is_admin());

drop policy if exists "admins manage channels" on public.ad_channels;
create policy "admins manage channels" on public.ad_channels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- page_visits: cualquiera puede insertar (tracking), solo admin lee
drop policy if exists "anon insert visits" on public.page_visits;
create policy "anon insert visits" on public.page_visits
  for insert to anon, authenticated with check (true);

drop policy if exists "admins read visits" on public.page_visits;
create policy "admins read visits" on public.page_visits
  for select to authenticated using (public.is_admin());

-- conversion_events
drop policy if exists "anon insert conversions" on public.conversion_events;
create policy "anon insert conversions" on public.conversion_events
  for insert to anon, authenticated with check (true);

drop policy if exists "admins read conversions" on public.conversion_events;
create policy "admins read conversions" on public.conversion_events
  for select to authenticated using (public.is_admin());

drop policy if exists "admins manage conversions" on public.conversion_events;
create policy "admins manage conversions" on public.conversion_events
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- appointments
drop policy if exists "admins manage appointments" on public.appointments;
create policy "admins manage appointments" on public.appointments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- services (lectura pública, escritura admin)
drop policy if exists "public read services" on public.services;
create policy "public read services" on public.services
  for select to anon, authenticated using (active = true or public.is_admin());

drop policy if exists "admins manage services" on public.services;
create policy "admins manage services" on public.services
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- pricing_zones
drop policy if exists "public read zones" on public.pricing_zones;
create policy "public read zones" on public.pricing_zones
  for select to anon, authenticated using (active = true or public.is_admin());

drop policy if exists "admins manage zones" on public.pricing_zones;
create policy "admins manage zones" on public.pricing_zones
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- price_extras
drop policy if exists "public read extras" on public.price_extras;
create policy "public read extras" on public.price_extras
  for select to anon, authenticated using (active = true or public.is_admin());

drop policy if exists "admins manage extras" on public.price_extras;
create policy "admins manage extras" on public.price_extras
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- site_media
drop policy if exists "public read media" on public.site_media;
create policy "public read media" on public.site_media
  for select to anon, authenticated using (true);

drop policy if exists "admins manage media" on public.site_media;
create policy "admins manage media" on public.site_media
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- site_settings
drop policy if exists "public read settings" on public.site_settings;
create policy "public read settings" on public.site_settings
  for select to anon, authenticated using (true);

drop policy if exists "admins manage settings" on public.site_settings;
create policy "admins manage settings" on public.site_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Storage bucket para imágenes del sitio
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('site-images', 'site-images', true)
on conflict (id) do nothing;

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
