-- =============================================================================
-- Armonivet · Bloquear horas sueltas (no el día completo)
-- SQL Editor de Supabase. Se puede correr más de una vez.
--
-- Qué hace:
--   * Tabla booking_slot_blocks: cada fila es un tramo bloqueado (inicio y fin).
--   * list_available_slots pasa a envolver la versión que ya está instalada y
--     le saca las horas que se cruzan con un bloqueo. Como la web, Génesis y
--     book_public_appointment usan esa misma función, la hora queda cerrada en
--     todos lados.
--
-- Si más adelante volvés a correr un SQL que redefine list_available_slots
-- (booking.sql, booking_modes.sql, calendar_settings.sql, payment_holds.sql),
-- corré este archivo de nuevo después: vuelve a envolver la versión nueva.
-- =============================================================================

create table if not exists public.booking_slot_blocks (
  id uuid primary key default gen_random_uuid(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint booking_slot_blocks_range check (ends_at > starts_at)
);

create unique index if not exists booking_slot_blocks_start_idx
  on public.booking_slot_blocks (starts_at);

alter table public.booking_slot_blocks enable row level security;

drop policy if exists "admins manage booking_slot_blocks" on public.booking_slot_blocks;
create policy "admins manage booking_slot_blocks" on public.booking_slot_blocks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, delete on public.booking_slot_blocks to authenticated;

-- -----------------------------------------------------------------------------
-- Guarda la función de horas libres instalada como list_available_slots_base.
-- Si la actual ya es el envoltorio, no hace nada. Si alguien volvió a correr un
-- SQL viejo y la pisó, reemplaza la base guardada por esa versión nueva.
-- -----------------------------------------------------------------------------
do $$
declare
  current_src text;
begin
  select p.prosrc into current_src
  from pg_proc p
  where p.oid = to_regprocedure('public.list_available_slots(integer, text)');

  if current_src is null then
    raise exception 'No existe list_available_slots(integer, text). Corré antes booking_modes.sql / payment_holds.sql.';
  end if;

  if position('list_available_slots_base' in current_src) = 0 then
    drop function if exists public.list_available_slots_base(integer, text);
    alter function public.list_available_slots(integer, text) rename to list_available_slots_base;
  end if;
end;
$$;

revoke all on function public.list_available_slots_base(integer, text) from public, anon, authenticated;

create or replace function public.list_available_slots(
  p_days integer default 21,
  p_mode text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  base jsonb;
  dur_online int;
  dur_presencial int;
  filtered jsonb;
begin
  -- Envoltorio: toda la lógica de agenda vive en list_available_slots_base.
  base := public.list_available_slots_base(p_days, p_mode);
  if base is null or jsonb_typeof(base->'slots') is distinct from 'array' then
    return base;
  end if;

  dur_online := coalesce((base->>'duration_online')::int, 60);
  dur_presencial := coalesce((base->>'duration_presencial')::int, 60);

  select coalesce(jsonb_agg(s.slot order by s.ord), '[]'::jsonb)
    into filtered
  from jsonb_array_elements(base->'slots') with ordinality as s(slot, ord)
  where not exists (
    select 1
    from public.booking_slot_blocks b
    where (s.slot->>'at')::timestamptz < b.ends_at
      and (s.slot->>'at')::timestamptz
          + make_interval(mins => case when s.slot->>'mode' = 'online' then dur_online else dur_presencial end)
          > b.starts_at
  );

  return jsonb_set(base, '{slots}', filtered);
end;
$$;

grant execute on function public.list_available_slots(integer, text) to anon, authenticated;

notify pgrst, 'reload schema';
