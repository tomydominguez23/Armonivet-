-- =============================================================================
-- Armonivet · Génesis (WhatsApp Cloud API + agente)
-- Ejecutar DESPUÉS de schema.sql y schema_v2.sql
-- =============================================================================

-- Teléfono normalizado (solo dígitos)
create or replace function public.normalize_phone(raw text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '');
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'wa_phone'
  ) then
    alter table public.clients add column wa_phone text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'wa_name'
  ) then
    alter table public.clients add column wa_name text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'pipeline'
  ) then
    alter table public.leads add column pipeline text;
  end if;
end $$;

create index if not exists clients_wa_phone_idx on public.clients (wa_phone);

-- -----------------------------------------------------------------------------
-- Conversaciones WhatsApp
-- -----------------------------------------------------------------------------
create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  lead_id uuid references public.leads (id) on delete set null,
  wa_phone text not null,
  wa_name text,
  channel text not null default 'whatsapp',
  status text not null default 'abierta'
    check (status in ('abierta', 'pausada_humano', 'cerrada')),
  assigned_to text not null default 'genesis'
    check (assigned_to in ('genesis', 'humano')),
  pipeline text not null default 'nuevo'
    check (pipeline in (
      'nuevo', 'contactado', 'calificado', 'quiere_agendar', 'esperando_pago',
      'pagado', 'agendado', 'atendido', 'seguimiento', 'control',
      'no_responde', 'cancelado', 'perdido', 'derivado_humano'
    )),
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wa_conversations_phone_idx
  on public.wa_conversations (wa_phone)
  where channel = 'whatsapp';
create index if not exists wa_conversations_updated_idx
  on public.wa_conversations (last_message_at desc nulls last);

alter table public.wa_conversations enable row level security;

drop trigger if exists wa_conversations_touch on public.wa_conversations;
create trigger wa_conversations_touch
  before update on public.wa_conversations
  for each row execute function public.touch_updated_at();

drop policy if exists "admins manage wa conversations" on public.wa_conversations;
create policy "admins manage wa conversations" on public.wa_conversations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Mensajes
-- -----------------------------------------------------------------------------
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  author text not null check (author in ('cliente', 'genesis', 'humano', 'sistema')),
  message_type text not null default 'text',
  content text,
  wa_message_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists wa_messages_wa_id_idx
  on public.wa_messages (wa_message_id)
  where wa_message_id is not null;
create index if not exists wa_messages_conv_idx
  on public.wa_messages (conversation_id, created_at);

alter table public.wa_messages enable row level security;

drop policy if exists "admins manage wa messages" on public.wa_messages;
create policy "admins manage wa messages" on public.wa_messages
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Pagos (abono / saldo)
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  conversation_id uuid references public.wa_conversations (id) on delete set null,
  amount integer not null default 20000,
  kind text not null default 'abono' check (kind in ('abono', 'saldo', 'otro')),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'pagado', 'vencido', 'cancelado')),
  provider text,
  checkout_url text,
  due_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_status_idx on public.payments (status, due_at);

alter table public.payments enable row level security;

drop trigger if exists payments_touch on public.payments;
create trigger payments_touch
  before update on public.payments
  for each row execute function public.touch_updated_at();

drop policy if exists "admins manage payments" on public.payments;
create policy "admins manage payments" on public.payments
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Recordatorios programados
-- -----------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.wa_conversations (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  appointment_id uuid references public.appointments (id) on delete set null,
  payment_id uuid references public.payments (id) on delete set null,
  kind text not null,
  body text,
  scheduled_at timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviado', 'cancelado', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists reminders_due_idx
  on public.reminders (scheduled_at)
  where status = 'pendiente';

alter table public.reminders enable row level security;

drop policy if exists "admins manage reminders" on public.reminders;
create policy "admins manage reminders" on public.reminders
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Auditoría de acciones de Génesis
-- -----------------------------------------------------------------------------
create table if not exists public.genesis_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.wa_conversations (id) on delete set null,
  client_id uuid references public.clients (id) on delete set null,
  action text not null,
  parameters jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  status text not null default 'ok' check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);

create index if not exists genesis_actions_created_idx
  on public.genesis_actions (created_at desc);

alter table public.genesis_actions enable row level security;

drop policy if exists "admins read genesis actions" on public.genesis_actions;
create policy "admins read genesis actions" on public.genesis_actions
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Memoria corta por cliente
-- -----------------------------------------------------------------------------
create table if not exists public.genesis_memory (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients (id) on delete cascade,
  conversation_id uuid references public.wa_conversations (id) on delete cascade,
  key text not null,
  value text,
  created_at timestamptz not null default now()
);

alter table public.genesis_memory enable row level security;

drop policy if exists "admins manage genesis memory" on public.genesis_memory;
create policy "admins manage genesis memory" on public.genesis_memory
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Realtime para el dashboard
-- -----------------------------------------------------------------------------
alter table public.wa_conversations replica identity full;
alter table public.wa_messages replica identity full;
alter table public.payments replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.wa_conversations;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.wa_messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.payments;
  exception when duplicate_object then null;
  end;
end $$;

-- -----------------------------------------------------------------------------
-- Grants (solo authenticated/admin; el webhook usa service role)
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.wa_conversations to authenticated;
grant select, insert, update, delete on public.wa_messages to authenticated;
grant select, insert, update, delete on public.payments to authenticated;
grant select, insert, update, delete on public.reminders to authenticated;
grant select, insert, update, delete on public.genesis_actions to authenticated;
grant select, insert, update, delete on public.genesis_memory to authenticated;

-- -----------------------------------------------------------------------------
-- Ajustes de Génesis
-- -----------------------------------------------------------------------------
insert into public.site_settings (key, value) values (
  'genesis',
  '{
    "enabled": true,
    "model": "gpt-5.6",
    "model_complex": "gpt-5.6",
    "deposit_amount": 20000,
    "min_price": 40000,
    "payment_url": "",
    "calendly_url": "https://calendly.com/armonivet/consulta-etologia-clinica",
    "timezone": "America/Santiago",
    "slot_hours": ["10:00", "12:00", "15:00", "17:30"],
    "workdays": [1, 2, 3, 4, 5, 6],
    "system_prompt": "Eres Génesis, secretaria de Armonivet (etología clínica, entrenamiento y Flores de Bach). Hablas en español de Chile, cálida, clara y breve. No das diagnósticos veterinarios ni recetas. Tu trabajo es calificar leads, agendar consultas, cobrar el abono de $20.000 para confirmar (vence a las 12 horas), reagendar, recordar y escalar a la Dra. Bárbara cuando haga falta. Nunca inventes precios, horarios ni pagos: usa las herramientas. Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo. Si pide consejo clínico profundo, agenda consulta."
  }'::jsonb
)
on conflict (key) do nothing;
