-- =============================================================================
-- Armonivet · Schema v2: Clientes, Leads, Cuestionario pre-consulta,
-- Seguimiento, Chat Genesis y dashboard mejorado
-- Ejecutar DESPUÉS del schema.sql original
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Clientes (tabla normalizada)
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  address text,
  tutor_name text,
  tutor_age integer,
  tutor_occupation text,
  pet_name text,
  pet_type text check (pet_type in ('perro', 'gato', 'otro')),
  pet_breed text,
  pet_age text,
  pet_size text,
  pet_weight text,
  is_neutered boolean,
  neutered_date text,
  last_vet_visit text,
  last_vet_reason text,
  vaccines_up_to_date boolean,
  diagnosed_conditions text,
  current_treatment text,
  household_members text,
  pet_origin text,
  pet_adoption_age text,
  previous_owner boolean,
  consultation_reason text,
  behavior_frequency text,
  previous_ethologist boolean,
  previous_trainer boolean,
  known_commands text,
  attempted_solutions text,
  life_changes text,
  housing_type text,
  time_spent_location text,
  adopted_pandemic text check (adopted_pandemic in ('Si', 'Antes de la Pandemia', 'Después de la Pandemia', null)),
  channel_slug text,
  status text not null default 'lead'
    check (status in ('lead', 'contactado', 'agendado', 'abonado', 'atendido', 'en_seguimiento', 'control_pendiente', 'completado', 'perdido')),
  tags text[] default '{}',
  notes text,
  last_contact_at timestamptz,
  next_followup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clients_status_idx on public.clients (status);
create index if not exists clients_next_followup_idx on public.clients (next_followup_at);
create index if not exists clients_phone_idx on public.clients (phone);
create index if not exists clients_email_idx on public.clients (email);

alter table public.clients enable row level security;

drop trigger if exists clients_touch on public.clients;
create trigger clients_touch
  before update on public.clients
  for each row execute function public.touch_updated_at();

-- Políticas RLS para clients
drop policy if exists "admins manage clients" on public.clients;
create policy "admins manage clients" on public.clients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "anon insert clients" on public.clients;
create policy "anon insert clients" on public.clients
  for insert to anon, authenticated
  with check (true);

-- -----------------------------------------------------------------------------
-- Leads (formulario del chat Genesis)
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  session_id text,
  source text not null default 'chat_genesis',
  name text,
  phone text,
  email text,
  pet_type text,
  pet_name text,
  pet_age text,
  consultation_reason text,
  status text not null default 'nuevo'
    check (status in ('nuevo', 'contactado', 'calificado', 'agendado', 'descartado')),
  channel_slug text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_created_idx on public.leads (created_at desc);

alter table public.leads enable row level security;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch
  before update on public.leads
  for each row execute function public.touch_updated_at();

drop policy if exists "admins manage leads" on public.leads;
create policy "admins manage leads" on public.leads
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "anon insert leads" on public.leads;
create policy "anon insert leads" on public.leads
  for insert to anon, authenticated
  with check (true);

-- -----------------------------------------------------------------------------
-- Cuestionario pre-consulta (respuestas completas)
-- -----------------------------------------------------------------------------
create table if not exists public.intake_forms (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete set null,
  email text,
  patient_name text,
  address text,
  tutor_info text,
  patient_data text,
  pet_purpose text,
  is_neutered text,
  last_vet_visit text,
  vaccines_status text,
  diagnosed_conditions text,
  household_members text,
  pet_history text,
  consultation_reason text,
  behavior_timing text,
  previous_ethologist text,
  known_commands text,
  attempted_solutions text,
  life_changes text,
  housing_info text,
  pandemic_adoption text,
  completed boolean not null default false,
  raw_answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.intake_forms enable row level security;

drop policy if exists "admins manage intake" on public.intake_forms;
create policy "admins manage intake" on public.intake_forms
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "anon insert intake" on public.intake_forms;
create policy "anon insert intake" on public.intake_forms
  for insert to anon, authenticated
  with check (true);

-- -----------------------------------------------------------------------------
-- Seguimiento / follow-ups
-- -----------------------------------------------------------------------------
create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  appointment_id uuid references public.appointments (id) on delete set null,
  type text not null default 'nota'
    check (type in ('nota', 'llamada', 'whatsapp', 'email', 'control', 'recordatorio')),
  content text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  completed boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists followups_client_idx on public.followups (client_id);
create index if not exists followups_scheduled_idx on public.followups (scheduled_at)
  where not completed;

alter table public.followups enable row level security;

drop policy if exists "admins manage followups" on public.followups;
create policy "admins manage followups" on public.followups
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Chat Genesis (conversaciones del widget)
-- -----------------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  client_id uuid references public.clients (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  visitor_name text,
  status text not null default 'activa'
    check (status in ('activa', 'completada', 'abandonada')),
  current_step integer not null default 0,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conv_session_idx on public.chat_conversations (session_id);

alter table public.chat_conversations enable row level security;

drop trigger if exists chat_conv_touch on public.chat_conversations;
create trigger chat_conv_touch
  before update on public.chat_conversations
  for each row execute function public.touch_updated_at();

drop policy if exists "admins manage chat" on public.chat_conversations;
create policy "admins manage chat" on public.chat_conversations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "anon insert chat" on public.chat_conversations;
create policy "anon insert chat" on public.chat_conversations
  for insert to anon, authenticated
  with check (true);

drop policy if exists "anon update own chat" on public.chat_conversations;
create policy "anon update own chat" on public.chat_conversations
  for update to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "anon read own chat" on public.chat_conversations;
create policy "anon read own chat" on public.chat_conversations
  for select to anon, authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- Vincular appointments con clients
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'client_id'
  ) then
    alter table public.appointments add column client_id uuid references public.clients (id) on delete set null;
    create index appointments_client_idx on public.appointments (client_id);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant select, insert on public.clients to anon;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert on public.leads to anon;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.intake_forms to anon;
grant select, insert, update, delete on public.intake_forms to authenticated;
grant select, insert, update, delete on public.followups to authenticated;
grant select, insert, update on public.chat_conversations to anon;
grant select, insert, update, delete on public.chat_conversations to authenticated;

-- -----------------------------------------------------------------------------
-- RPC: submit chat (security definer para insertar lead + client + form)
-- -----------------------------------------------------------------------------
create or replace function public.submit_genesis_chat(
  p_session_id text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_lead_id uuid;
  v_form_id uuid;
  v_conv_id uuid;
begin
  -- Crear cliente
  insert into public.clients (
    name, email, phone, address, pet_name, pet_type, pet_age,
    consultation_reason, channel_slug, status
  ) values (
    coalesce(p_answers->>'tutor_name', p_answers->>'name', 'Sin nombre'),
    p_answers->>'email',
    p_answers->>'phone',
    p_answers->>'address',
    p_answers->>'pet_name',
    case
      when lower(coalesce(p_answers->>'pet_type', '')) in ('perro', 'gato', 'otro') then lower(p_answers->>'pet_type')
      else 'otro'
    end,
    p_answers->>'pet_age',
    p_answers->>'consultation_reason',
    coalesce(p_answers->>'channel', 'chat_genesis'),
    'lead'
  )
  returning id into v_client_id;

  -- Crear lead
  insert into public.leads (
    client_id, session_id, source, name, phone, email,
    pet_type, pet_name, pet_age, consultation_reason, status, metadata
  ) values (
    v_client_id, p_session_id, 'chat_genesis',
    p_answers->>'tutor_name',
    p_answers->>'phone',
    p_answers->>'email',
    p_answers->>'pet_type',
    p_answers->>'pet_name',
    p_answers->>'pet_age',
    p_answers->>'consultation_reason',
    'nuevo',
    p_answers
  )
  returning id into v_lead_id;

  -- Crear formulario
  insert into public.intake_forms (
    client_id, lead_id, email, patient_name, address, tutor_info,
    patient_data, pet_purpose, is_neutered, last_vet_visit,
    vaccines_status, diagnosed_conditions, household_members,
    pet_history, consultation_reason, behavior_timing,
    previous_ethologist, known_commands, attempted_solutions,
    life_changes, housing_info, pandemic_adoption, completed, raw_answers
  ) values (
    v_client_id, v_lead_id, p_answers->>'email',
    p_answers->>'pet_name', p_answers->>'address',
    p_answers->>'tutor_info', p_answers->>'patient_data',
    p_answers->>'pet_purpose', p_answers->>'is_neutered',
    p_answers->>'last_vet_visit', p_answers->>'vaccines_status',
    p_answers->>'diagnosed_conditions', p_answers->>'household_members',
    p_answers->>'pet_history', p_answers->>'consultation_reason',
    p_answers->>'behavior_timing', p_answers->>'previous_ethologist',
    p_answers->>'known_commands', p_answers->>'attempted_solutions',
    p_answers->>'life_changes', p_answers->>'housing_info',
    p_answers->>'pandemic_adoption', true, p_answers
  )
  returning id into v_form_id;

  -- Actualizar conversación
  update public.chat_conversations
  set client_id = v_client_id, lead_id = v_lead_id, status = 'completada', answers = p_answers
  where session_id = p_session_id;

  return jsonb_build_object(
    'client_id', v_client_id,
    'lead_id', v_lead_id,
    'form_id', v_form_id
  );
end;
$$;

grant execute on function public.submit_genesis_chat(text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- RPC: dashboard v2 con leads y seguimiento
-- -----------------------------------------------------------------------------
create or replace function public.admin_dashboard_v2(days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  since timestamptz := now() - make_interval(days => greatest(days, 1));
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'visits_unique', (select count(*) from public.page_visits where created_at >= since and is_unique_session),
    'visits_total', (select count(*) from public.page_visits where created_at >= since),
    'click_agendar', (select count(*) from public.conversion_events where created_at >= since and event_type = 'click_agendar'),
    'leads_total', (select count(*) from public.leads where created_at >= since),
    'leads_new', (select count(*) from public.leads where created_at >= since and status = 'nuevo'),
    'appointments_total', (select count(*) from public.appointments where created_at >= since and status <> 'cancelada'),
    'paid', (select count(*) from public.appointments where created_at >= since and (deposit_paid or status in ('abonada','llegó','completada'))),
    'arrived', (select count(*) from public.appointments where created_at >= since and status in ('llegó','completada')),
    'revenue', (select coalesce(sum(amount),0) from public.appointments where created_at >= since and status in ('abonada','llegó','completada')),
    'clients_total', (select count(*) from public.clients where created_at >= since),
    'followups_pending', (select count(*) from public.followups where not completed and (scheduled_at is null or scheduled_at <= now() + interval '3 days')),
    'controls_overdue', (
      select count(*) from public.clients
      where status = 'en_seguimiento'
        and next_followup_at is not null
        and next_followup_at < now()
    ),
    'by_channel', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select coalesce(nullif(channel_slug,''),'directo') as channel, count(*) filter (where is_unique_session) as unique_visits
        from public.page_visits where created_at >= since group by 1 order by unique_visits desc limit 12
      ) t
    ),
    'visits_by_day', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select date_trunc('day',created_at)::date as day, count(*) filter (where is_unique_session) as unique_visits, count(*) as hits
        from public.page_visits where created_at >= since group by 1 order by 1
      ) t
    ),
    'leads_by_status', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select status, count(*) as total from public.leads where created_at >= since group by status order by total desc
      ) t
    ),
    'appointments_by_status', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select status, count(*) as total from public.appointments where created_at >= since group by status order by total desc
      ) t
    ),
    'recent_leads', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select id, name, phone, email, pet_type, pet_name, status, source, created_at
        from public.leads order by created_at desc limit 10
      ) t
    ),
    'clients_need_followup', (
      select coalesce(jsonb_agg(row_to_json(t)),'[]'::jsonb) from (
        select id, name, phone, pet_name, status, next_followup_at, last_contact_at
        from public.clients
        where status in ('en_seguimiento','control_pendiente','atendido')
          and (next_followup_at is null or next_followup_at <= now() + interval '3 days')
        order by coalesce(next_followup_at, '1970-01-01'::timestamptz) asc
        limit 15
      ) t
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_dashboard_v2(integer) from public;
grant execute on function public.admin_dashboard_v2(integer) to authenticated;
