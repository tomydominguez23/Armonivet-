-- =============================================================================
-- Armonivet · Génesis como asistente de la doctora
-- SQL Editor de Supabase. Se puede correr más de una vez.
--
-- Qué hace:
--   * genesis_admin_messages: la conversación entre la doctora y Génesis
--     (separada de los chats de clientes, no crea leads ni aparece en el panel).
--   * genesis_admin_actions: mensajes a clientes que esperan el "sí" de la
--     doctora antes de enviarse.
--   * payments.owner_notified_at: para avisarle una sola vez cada reserva pagada.
--
-- Además hay que cargar el secreto GENESIS_ADMIN_PHONES en Supabase → Edge
-- Functions → Secrets con el número de la doctora (ej. 56912345678). Varios
-- números se separan con coma.
-- =============================================================================

create table if not exists public.genesis_admin_messages (
  id uuid primary key default gen_random_uuid(),
  admin_phone text not null,
  direction text not null check (direction in ('in', 'out')),
  content text,
  wa_message_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists genesis_admin_messages_wa_id_idx
  on public.genesis_admin_messages (wa_message_id)
  where wa_message_id is not null;

create index if not exists genesis_admin_messages_phone_idx
  on public.genesis_admin_messages (admin_phone, created_at desc);

create table if not exists public.genesis_admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_phone text not null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviando', 'enviado', 'cancelado', 'error')),
  result jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists genesis_admin_actions_pending_idx
  on public.genesis_admin_actions (admin_phone, created_at desc)
  where status = 'pendiente';

-- Solo las Edge Functions (service_role) escriben; el panel puede leer.
alter table public.genesis_admin_messages enable row level security;
alter table public.genesis_admin_actions enable row level security;

drop policy if exists "admins read genesis_admin_messages" on public.genesis_admin_messages;
create policy "admins read genesis_admin_messages" on public.genesis_admin_messages
  for select to authenticated using (public.is_admin());

drop policy if exists "admins read genesis_admin_actions" on public.genesis_admin_actions;
create policy "admins read genesis_admin_actions" on public.genesis_admin_actions
  for select to authenticated using (public.is_admin());

grant select on public.genesis_admin_messages, public.genesis_admin_actions to authenticated;

alter table public.payments
  add column if not exists owner_notified_at timestamptz;

notify pgrst, 'reload schema';
