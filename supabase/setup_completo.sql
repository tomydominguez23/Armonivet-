-- =============================================================================
-- ARMONIVET · SQL COMPLETO (pegar TODO en SQL Editor → Run)
-- Incluye: schema base, schema v2, RPCs, permisos, tracking, storage y seed
-- =============================================================================

create extension if not exists "pgcrypto";

-- ====================== FUNCIONES BASE ======================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','staff'));
$$;

-- ====================== TABLAS BASE =========================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text, full_name text,
  role text not null default 'admin' check (role in ('admin','staff')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), coalesce(new.raw_user_meta_data->>'role','admin'))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Canales
create table if not exists public.ad_channels (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  utm_source text, utm_medium text, utm_campaign text,
  color text default '#2f6f84', active boolean not null default true,
  notes text, created_at timestamptz not null default now()
);
alter table public.ad_channels enable row level security;

-- Visitas
create table if not exists public.page_visits (
  id uuid primary key default gen_random_uuid(),
  session_id text not null, path text not null default '/',
  referrer text, utm_source text, utm_medium text, utm_campaign text,
  channel_slug text, user_agent text, device text,
  landing_path text, is_unique_session boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists page_visits_created_at_idx on public.page_visits (created_at desc);
create index if not exists page_visits_session_idx on public.page_visits (session_id);
create index if not exists page_visits_channel_idx on public.page_visits (channel_slug);
alter table public.page_visits enable row level security;

-- Conversiones
create table if not exists public.conversion_events (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  event_type text not null check (event_type in ('page_view','click_agendar','click_formulario','click_instagram','appointment_booked','payment_confirmed','arrived','completed')),
  channel_slug text, label text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conversion_events_type_idx on public.conversion_events (event_type, created_at desc);
alter table public.conversion_events enable row level security;

-- Citas
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  client_name text not null, client_email text, client_phone text,
  pet_name text, pet_type text, service_title text, zone text,
  scheduled_at timestamptz,
  status text not null default 'agendada' check (status in ('agendada','abonada','llegó','completada','cancelada','no_asistió')),
  amount integer default 0, deposit_amount integer default 20000,
  deposit_paid boolean not null default false,
  channel_slug text, notes text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists appointments_status_idx on public.appointments (status);
create index if not exists appointments_scheduled_idx on public.appointments (scheduled_at);
alter table public.appointments enable row level security;
drop trigger if exists appointments_touch on public.appointments;
create trigger appointments_touch before update on public.appointments for each row execute function public.touch_updated_at();

-- Servicios
create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique, title text not null, description text,
  price_from integer, price_label text, image_url text, tag text,
  calendly_url text default 'https://calendly.com/armonivet/consulta-etologia-clinica',
  sort_order integer not null default 0, active boolean not null default true,
  section text not null default 'servicios' check (section in ('servicios','ofertas','ambos')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
drop trigger if exists services_touch on public.services;
create trigger services_touch before update on public.services for each row execute function public.touch_updated_at();
alter table public.services enable row level security;

-- Zonas de precio
create table if not exists public.pricing_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null, badge text, price integer not null,
  zones_text text, image_url text, map_embed_url text,
  featured boolean not null default false, sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
drop trigger if exists pricing_zones_touch on public.pricing_zones;
create trigger pricing_zones_touch before update on public.pricing_zones for each row execute function public.touch_updated_at();
alter table public.pricing_zones enable row level security;

create table if not exists public.price_extras (
  id uuid primary key default gen_random_uuid(),
  label text not null, amount integer not null, sort_order integer not null default 0, active boolean not null default true
);
alter table public.price_extras enable row level security;

-- Media
create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  slot text not null unique, title text, url text not null, alt_text text,
  updated_at timestamptz not null default now()
);
drop trigger if exists site_media_touch on public.site_media;
create trigger site_media_touch before update on public.site_media for each row execute function public.touch_updated_at();
alter table public.site_media enable row level security;

-- Settings
create table if not exists public.site_settings (
  key text primary key, value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings for each row execute function public.touch_updated_at();
alter table public.site_settings enable row level security;

-- Vistas
create or replace view public.daily_stats as
  select date_trunc('day',created_at)::date as day, count(*) filter (where is_unique_session) as unique_visits, count(*) as page_hits
  from public.page_visits group by 1 order by 1 desc;

create or replace view public.channel_stats as
  select coalesce(nullif(channel_slug,''),'directo') as channel_slug, count(*) filter (where is_unique_session) as unique_visits, count(*) as page_hits
  from public.page_visits group by 1 order by unique_visits desc;

-- ====================== SCHEMA V2: Clientes, Leads, Chat, Seguimiento ======

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text, phone text, address text,
  tutor_name text, tutor_age integer, tutor_occupation text,
  pet_name text,
  pet_type text check (pet_type in ('perro','gato','otro')),
  pet_breed text, pet_age text, pet_size text, pet_weight text,
  is_neutered boolean, neutered_date text,
  last_vet_visit text, last_vet_reason text,
  vaccines_up_to_date boolean, diagnosed_conditions text, current_treatment text,
  household_members text, pet_origin text, pet_adoption_age text, previous_owner boolean,
  consultation_reason text, behavior_frequency text,
  previous_ethologist boolean, previous_trainer boolean,
  known_commands text, attempted_solutions text, life_changes text,
  housing_type text, time_spent_location text,
  adopted_pandemic text check (adopted_pandemic in ('Si','Antes de la Pandemia','Después de la Pandemia',null)),
  channel_slug text,
  status text not null default 'lead' check (status in ('lead','contactado','agendado','abonado','atendido','en_seguimiento','control_pendiente','completado','perdido')),
  tags text[] default '{}', notes text,
  last_contact_at timestamptz, next_followup_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_next_followup_idx on public.clients (next_followup_at);
create index if not exists clients_phone_idx on public.clients (phone);
create index if not exists clients_email_idx on public.clients (email);
alter table public.clients enable row level security;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  session_id text, source text not null default 'chat_genesis',
  name text, phone text, email text, pet_type text, pet_name text, pet_age text,
  consultation_reason text,
  status text not null default 'nuevo' check (status in ('nuevo','contactado','calificado','agendado','descartado')),
  channel_slug text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_idx on public.leads (created_at desc);
alter table public.leads enable row level security;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated_at();

create table if not exists public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  email text, patient_name text, address text, tutor_info text,
  patient_data text, pet_purpose text, is_neutered text,
  last_vet_visit text, vaccines_status text, diagnosed_conditions text,
  household_members text, pet_history text, consultation_reason text,
  behavior_timing text, previous_ethologist text, known_commands text,
  attempted_solutions text, life_changes text, housing_info text,
  pandemic_adoption text,
  completed boolean not null default false, raw_answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.intake_forms enable row level security;

create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  type text not null default 'nota' check (type in ('nota','llamada','whatsapp','email','control','recordatorio')),
  content text, scheduled_at timestamptz, completed_at timestamptz,
  completed boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists followups_client_idx on public.followups (client_id);
create index if not exists followups_scheduled_idx on public.followups (scheduled_at) where not completed;
alter table public.followups enable row level security;

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  client_id uuid references public.clients (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  visitor_name text,
  status text not null default 'activa' check (status in ('activa','completada','abandonada')),
  current_step integer not null default 0, answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists chat_conv_session_idx on public.chat_conversations (session_id);
alter table public.chat_conversations enable row level security;
drop trigger if exists chat_conv_touch on public.chat_conversations;
create trigger chat_conv_touch before update on public.chat_conversations for each row execute function public.touch_updated_at();

-- Vincular appointments con clients
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='appointments' and column_name='client_id') then
    alter table public.appointments add column client_id uuid references public.clients (id) on delete set null;
    create index appointments_client_idx on public.appointments (client_id);
  end if;
end $$;

-- ====================== RLS POLICIES ========================================

-- profiles
drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles for select to authenticated using (public.is_admin());
drop policy if exists "admins update own profile" on public.profiles;
create policy "admins update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- ad_channels
drop policy if exists "public read channels" on public.ad_channels;
create policy "public read channels" on public.ad_channels for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists "admins manage channels" on public.ad_channels;
create policy "admins manage channels" on public.ad_channels for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- page_visits
drop policy if exists "anon insert visits" on public.page_visits;
drop policy if exists "public insert visits" on public.page_visits;
create policy "public insert visits" on public.page_visits for insert with check (true);
drop policy if exists "admins read visits" on public.page_visits;
create policy "admins read visits" on public.page_visits for select to authenticated using (public.is_admin());

-- conversion_events
drop policy if exists "anon insert conversions" on public.conversion_events;
drop policy if exists "public insert conversions" on public.conversion_events;
create policy "public insert conversions" on public.conversion_events for insert with check (true);
drop policy if exists "admins read conversions" on public.conversion_events;
create policy "admins read conversions" on public.conversion_events for select to authenticated using (public.is_admin());
drop policy if exists "admins manage conversions" on public.conversion_events;
create policy "admins manage conversions" on public.conversion_events for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- appointments
drop policy if exists "admins manage appointments" on public.appointments;
create policy "admins manage appointments" on public.appointments for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- services
drop policy if exists "public read services" on public.services;
create policy "public read services" on public.services for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists "admins manage services" on public.services;
create policy "admins manage services" on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- pricing_zones
drop policy if exists "public read zones" on public.pricing_zones;
create policy "public read zones" on public.pricing_zones for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists "admins manage zones" on public.pricing_zones;
create policy "admins manage zones" on public.pricing_zones for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- price_extras
drop policy if exists "public read extras" on public.price_extras;
create policy "public read extras" on public.price_extras for select to anon, authenticated using (active = true or public.is_admin());
drop policy if exists "admins manage extras" on public.price_extras;
create policy "admins manage extras" on public.price_extras for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- site_media
drop policy if exists "public read media" on public.site_media;
create policy "public read media" on public.site_media for select to anon, authenticated using (true);
drop policy if exists "admins manage media" on public.site_media;
create policy "admins manage media" on public.site_media for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- site_settings
drop policy if exists "public read settings" on public.site_settings;
create policy "public read settings" on public.site_settings for select to anon, authenticated using (true);
drop policy if exists "admins manage settings" on public.site_settings;
create policy "admins manage settings" on public.site_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- clients
drop policy if exists "admins manage clients" on public.clients;
create policy "admins manage clients" on public.clients for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "anon insert clients" on public.clients;
create policy "anon insert clients" on public.clients for insert to anon, authenticated with check (true);

-- leads
drop policy if exists "admins manage leads" on public.leads;
create policy "admins manage leads" on public.leads for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "anon insert leads" on public.leads;
create policy "anon insert leads" on public.leads for insert to anon, authenticated with check (true);

-- intake_forms
drop policy if exists "admins manage intake" on public.intake_forms;
create policy "admins manage intake" on public.intake_forms for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "anon insert intake" on public.intake_forms;
create policy "anon insert intake" on public.intake_forms for insert to anon, authenticated with check (true);

-- followups
drop policy if exists "admins manage followups" on public.followups;
create policy "admins manage followups" on public.followups for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- chat_conversations
drop policy if exists "admins manage chat" on public.chat_conversations;
create policy "admins manage chat" on public.chat_conversations for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "anon insert chat" on public.chat_conversations;
create policy "anon insert chat" on public.chat_conversations for insert to anon, authenticated with check (true);
drop policy if exists "anon update own chat" on public.chat_conversations;
create policy "anon update own chat" on public.chat_conversations for update to anon, authenticated using (true) with check (true);
drop policy if exists "anon read own chat" on public.chat_conversations;
create policy "anon read own chat" on public.chat_conversations for select to anon, authenticated using (true);

-- ====================== GRANTS ==============================================

grant usage on schema public to anon, authenticated;
grant select on public.services, public.ad_channels, public.pricing_zones, public.price_extras, public.site_media, public.site_settings to anon, authenticated;
grant insert on public.page_visits, public.conversion_events to anon, authenticated;
grant select, insert, update, delete on public.page_visits, public.conversion_events, public.appointments, public.services, public.ad_channels, public.pricing_zones, public.price_extras, public.site_media, public.site_settings, public.profiles to authenticated;
grant select, insert on public.clients to anon;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert on public.leads to anon;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.intake_forms to anon;
grant select, insert, update, delete on public.intake_forms to authenticated;
grant select, insert, update, delete on public.followups to authenticated;
grant select, insert, update on public.chat_conversations to anon;
grant select, insert, update, delete on public.chat_conversations to authenticated;

-- ====================== TRACKING RPCs =======================================

create or replace function public.track_page_visit(
  p_session_id text, p_path text default '/', p_referrer text default null,
  p_utm_source text default null, p_utm_medium text default null, p_utm_campaign text default null,
  p_channel_slug text default 'directo', p_user_agent text default null, p_device text default null,
  p_landing_path text default null, p_is_unique_session boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.page_visits (session_id,path,referrer,utm_source,utm_medium,utm_campaign,channel_slug,user_agent,device,landing_path,is_unique_session)
  values (p_session_id,coalesce(p_path,'/'),p_referrer,p_utm_source,p_utm_medium,p_utm_campaign,coalesce(p_channel_slug,'directo'),p_user_agent,p_device,p_landing_path,coalesce(p_is_unique_session,false))
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.track_conversion(
  p_event_type text, p_session_id text default null, p_channel_slug text default 'directo',
  p_label text default null, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  insert into public.conversion_events (session_id,event_type,channel_slug,label,metadata)
  values (p_session_id,p_event_type,coalesce(p_channel_slug,'directo'),p_label,coalesce(p_metadata,'{}'::jsonb))
  returning id into new_id;
  return new_id;
end; $$;

grant execute on function public.track_page_visit(text,text,text,text,text,text,text,text,text,text,boolean) to anon, authenticated;
grant execute on function public.track_conversion(text,text,text,text,jsonb) to anon, authenticated;

-- ====================== CHAT GENESIS RPC ====================================

create or replace function public.submit_genesis_chat(p_session_id text, p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client_id uuid; v_lead_id uuid; v_form_id uuid;
begin
  insert into public.clients (name,email,phone,address,pet_name,pet_type,pet_age,consultation_reason,channel_slug,status)
  values (
    coalesce(p_answers->>'tutor_name',p_answers->>'name','Sin nombre'),
    p_answers->>'email', p_answers->>'phone', p_answers->>'address', p_answers->>'pet_name',
    case when lower(coalesce(p_answers->>'pet_type','')) in ('perro','gato','otro') then lower(p_answers->>'pet_type') else 'otro' end,
    p_answers->>'pet_age', p_answers->>'consultation_reason', coalesce(p_answers->>'channel','chat_genesis'), 'lead'
  ) returning id into v_client_id;

  insert into public.leads (client_id,session_id,source,name,phone,email,pet_type,pet_name,pet_age,consultation_reason,status,metadata)
  values (v_client_id,p_session_id,'chat_genesis',p_answers->>'tutor_name',p_answers->>'phone',p_answers->>'email',
    p_answers->>'pet_type',p_answers->>'pet_name',p_answers->>'pet_age',p_answers->>'consultation_reason','nuevo',p_answers)
  returning id into v_lead_id;

  insert into public.intake_forms (client_id,lead_id,email,patient_name,address,tutor_info,patient_data,pet_purpose,is_neutered,last_vet_visit,vaccines_status,diagnosed_conditions,household_members,pet_history,consultation_reason,behavior_timing,previous_ethologist,known_commands,attempted_solutions,life_changes,housing_info,pandemic_adoption,completed,raw_answers)
  values (v_client_id,v_lead_id,p_answers->>'email',p_answers->>'pet_name',p_answers->>'address',p_answers->>'tutor_info',p_answers->>'patient_data',p_answers->>'pet_purpose',p_answers->>'is_neutered',p_answers->>'last_vet_visit',p_answers->>'vaccines_status',p_answers->>'diagnosed_conditions',p_answers->>'household_members',p_answers->>'pet_history',p_answers->>'consultation_reason',p_answers->>'behavior_timing',p_answers->>'previous_ethologist',p_answers->>'known_commands',p_answers->>'attempted_solutions',p_answers->>'life_changes',p_answers->>'housing_info',p_answers->>'pandemic_adoption',true,p_answers)
  returning id into v_form_id;

  update public.chat_conversations set client_id=v_client_id, lead_id=v_lead_id, status='completada', answers=p_answers where session_id=p_session_id;
  return jsonb_build_object('client_id',v_client_id,'lead_id',v_lead_id,'form_id',v_form_id);
end; $$;

grant execute on function public.submit_genesis_chat(text,jsonb) to anon, authenticated;

-- ====================== DASHBOARD RPCs ======================================

create or replace function public.admin_dashboard_stats(days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; since timestamptz := now() - make_interval(days => greatest(days,1));
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'visits_unique',(select count(*) from public.page_visits where created_at>=since and is_unique_session),
    'visits_total',(select count(*) from public.page_visits where created_at>=since),
    'click_agendar',(select count(*) from public.conversion_events where created_at>=since and event_type='click_agendar'),
    'appointments',(select count(*) from public.appointments where created_at>=since and status<>'cancelada'),
    'paid',(select count(*) from public.appointments where created_at>=since and (deposit_paid or status in ('abonada','llegó','completada'))),
    'arrived',(select count(*) from public.appointments where created_at>=since and status in ('llegó','completada')),
    'revenue_estimated',(select coalesce(sum(amount),0) from public.appointments where created_at>=since and status in ('abonada','llegó','completada')),
    'by_channel',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select coalesce(nullif(channel_slug,''),'directo') as channel, count(*) filter (where is_unique_session) as unique_visits from public.page_visits where created_at>=since group by 1 order by unique_visits desc limit 12) t),
    'visits_by_day',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select date_trunc('day',created_at)::date as day, count(*) filter (where is_unique_session) as unique_visits, count(*) as hits from public.page_visits where created_at>=since group by 1 order by 1) t),
    'appointments_by_status',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select status, count(*) as total from public.appointments where created_at>=since group by status order by total desc) t)
  ) into result;
  return result;
end; $$;

create or replace function public.admin_dashboard_v2(days integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; since timestamptz := now() - make_interval(days => greatest(days,1));
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'visits_unique',(select count(*) from public.page_visits where created_at>=since and is_unique_session),
    'visits_total',(select count(*) from public.page_visits where created_at>=since),
    'click_agendar',(select count(*) from public.conversion_events where created_at>=since and event_type='click_agendar'),
    'leads_total',(select count(*) from public.leads where created_at>=since),
    'leads_new',(select count(*) from public.leads where created_at>=since and status='nuevo'),
    'appointments_total',(select count(*) from public.appointments where created_at>=since and status<>'cancelada'),
    'paid',(select count(*) from public.appointments where created_at>=since and (deposit_paid or status in ('abonada','llegó','completada'))),
    'arrived',(select count(*) from public.appointments where created_at>=since and status in ('llegó','completada')),
    'revenue',(select coalesce(sum(amount),0) from public.appointments where created_at>=since and status in ('abonada','llegó','completada')),
    'clients_total',(select count(*) from public.clients where created_at>=since),
    'followups_pending',(select count(*) from public.followups where not completed and (scheduled_at is null or scheduled_at<=now()+interval '3 days')),
    'controls_overdue',(select count(*) from public.clients where status='en_seguimiento' and next_followup_at is not null and next_followup_at<now()),
    'by_channel',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select coalesce(nullif(channel_slug,''),'directo') as channel, count(*) filter (where is_unique_session) as unique_visits from public.page_visits where created_at>=since group by 1 order by unique_visits desc limit 12) t),
    'visits_by_day',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select date_trunc('day',created_at)::date as day, count(*) filter (where is_unique_session) as unique_visits, count(*) as hits from public.page_visits where created_at>=since group by 1 order by 1) t),
    'leads_by_status',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select status, count(*) as total from public.leads where created_at>=since group by status order by total desc) t),
    'appointments_by_status',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select status, count(*) as total from public.appointments where created_at>=since group by status order by total desc) t),
    'recent_leads',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select id,name,phone,email,pet_type,pet_name,status,source,created_at from public.leads order by created_at desc limit 10) t),
    'clients_need_followup',(select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (select id,name,phone,pet_name,status,next_followup_at,last_contact_at from public.clients where status in ('en_seguimiento','control_pendiente','atendido') and (next_followup_at is null or next_followup_at<=now()+interval '3 days') order by coalesce(next_followup_at,'1970-01-01'::timestamptz) asc limit 15) t)
  ) into result;
  return result;
end; $$;

revoke all on function public.admin_dashboard_stats(integer) from public;
grant execute on function public.admin_dashboard_stats(integer) to authenticated;
revoke all on function public.admin_dashboard_v2(integer) from public;
grant execute on function public.admin_dashboard_v2(integer) to authenticated;

-- ====================== STORAGE =============================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-images','site-images',true,10485760,array['image/jpeg','image/png','image/webp','image/gif','image/svg+xml'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "public read site images" on storage.objects;
create policy "public read site images" on storage.objects for select to anon, authenticated using (bucket_id='site-images');
drop policy if exists "admins upload site images" on storage.objects;
create policy "admins upload site images" on storage.objects for insert to authenticated with check (bucket_id='site-images' and public.is_admin());
drop policy if exists "admins update site images" on storage.objects;
create policy "admins update site images" on storage.objects for update to authenticated using (bucket_id='site-images' and public.is_admin()) with check (bucket_id='site-images' and public.is_admin());
drop policy if exists "admins delete site images" on storage.objects;
create policy "admins delete site images" on storage.objects for delete to authenticated using (bucket_id='site-images' and public.is_admin());

-- ====================== SEED DATA ===========================================

insert into public.ad_channels (name,slug,utm_source,utm_medium,utm_campaign,color) values
  ('Instagram Orgánico','instagram','instagram','social','organico','#E1306C'),
  ('Instagram Ads','instagram-ads','instagram','paid','ads','#C13584'),
  ('Google Ads','google-ads','google','cpc','search','#4285F4'),
  ('Facebook Ads','facebook-ads','facebook','paid','ads','#1877F2'),
  ('WhatsApp','whatsapp','whatsapp','referral','directo','#25D366'),
  ('Boca a boca','referido','referido','referral','boca-a-boca','#2f6f84'),
  ('Directo / Orgánico','directo',null,null,null,'#6b7380'),
  ('Tu Día / Medios','medios','medios','pr','tu-dia','#1f8a6e')
on conflict (slug) do nothing;

insert into public.services (slug,title,description,price_from,price_label,image_url,tag,sort_order,section) values
  ('etologia-clinica','Consulta Etología Clínica','Evaluación + plan + seguimiento 30 días',40000,'Desde $40.000','https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80','Más pedido',1,'ambos'),
  ('asesoria-felina-canina','Asesoría felina / canina','Miedo, ruidos, mudanzas y convivencia',40000,'Desde $40.000','https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=900&q=80','Gatos',2,'ambos'),
  ('consulta-online','Consulta Online Preferente','Ideal para agresividad, miedo y ansiedad',20000,'Abono $20.000','https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80','Online',3,'ambos'),
  ('entrenamiento-basico','Entrenamiento canino básico','Educación guiada para el día a día',null,'Consulta incluible','https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=900&q=80','Entrenamiento',4,'ambos'),
  ('flores-de-bach','Terapia con Flores de Bach','Complemento natural; primer frasco incluido si corresponde.',null,null,'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=800&q=80',null,5,'servicios')
on conflict (slug) do nothing;

delete from public.pricing_zones;
insert into public.pricing_zones (name,badge,price,zones_text,image_url,map_embed_url,featured,sort_order) values
  ('Sector A','Sector A',40000,'Ñuñoa y Macul','https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80','https://maps.google.com/maps?q=Ñuñoa,+Santiago,+Chile&hl=es&z=13&output=embed',false,1),
  ('Sector B','Sector B · Popular',45000,'Providencia, Santiago Centro (hasta Santa Lucía), San Joaquín, Vitacura (límite), Las Condes (hasta Padre Hurtado), La Reina (hasta Valenzuela Llano), Peñalolén (hasta Consistorial), San Miguel y La Florida.','https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=900&q=80','https://maps.google.com/maps?q=Providencia,+Santiago,+Chile&hl=es&z=13&output=embed',true,2),
  ('Sector C','Sector C',50000,'Santiago Centro (U. de Chile a Los Héroes), Lo Barnechea, La Dehesa, San Carlos de Apoquindo, oriente de Las Condes / La Reina / Vitacura / Peñalolén, San Bernardo, Puente Alto y Huechuraba.','https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=900&q=80','https://maps.google.com/maps?q=Las+Condes,+Santiago,+Chile&hl=es&z=12&output=embed',false,3);

delete from public.price_extras;
insert into public.price_extras (label,amount,sort_order) values ('Las Vizcachas',5000,1),('Domingos y festivos',10000,2),('Abono para confirmar (12 horas)',20000,3);

insert into public.site_media (slot,title,url,alt_text) values
  ('hero_1','Hero slide 1','https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=2000&q=80','Consulta profesional'),
  ('hero_2','Hero slide 2','https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=2000&q=80','Perros y gatos'),
  ('hero_3','Hero slide 3','https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=2000&q=80','Consulta online'),
  ('gallery_1','Galería 1','https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=800&q=80','Perro feliz en casa'),
  ('gallery_2','Galería 2','https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=800&q=80','Gato en reposo'),
  ('gallery_3','Galería 3','https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=800&q=80','Perro corriendo'),
  ('gallery_4','Galería 4','https://images.unsplash.com/photo-1596854407944-bf87f6fdd49e?auto=format&fit=crop&w=800&q=80','Gato atento'),
  ('gallery_5','Galería 5','https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=800&q=80','Cachorro con tutor'),
  ('gallery_6','Galería 6','https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=800&q=80','Paseo con perro'),
  ('about_doctor','Foto Dra. Bárbara','./dra-barbara.jpg','Dra. Bárbara Castillo'),
  ('mid_banner','Banner medio','https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=1200&q=80','Perro y gato juntos')
on conflict (slot) do nothing;

insert into public.site_settings (key,value) values ('business','{
  "name":"Armonivet",
  "tagline":"Etología clínica · Entrenamiento · Flores de Bach · Santiago",
  "calendly_url":"https://calendly.com/armonivet/consulta-etologia-clinica",
  "form_url":"https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform",
  "instagram_url":"https://www.instagram.com/armonivet/",
  "promo_text":"Desde $40.000 · Consulta + seguimiento 30 días · Flores de Bach si corresponde",
  "deposit_amount":20000,"min_price":40000
}'::jsonb) on conflict (key) do nothing;

-- ====================== VERIFICACIÓN ========================================
select 'OK' as resultado, count(*) as tablas
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';
