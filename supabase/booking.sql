-- =============================================================================
-- Armonivet · Agenda propia (reemplaza Calendly)
-- Una sola fuente de verdad: appointments + horarios de Génesis + bloqueos
-- SQL Editor, después de genesis.sql
-- =============================================================================

create table if not exists public.booking_blocks (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists booking_blocks_day_idx on public.booking_blocks (day);

alter table public.booking_blocks enable row level security;

drop policy if exists "admins manage booking_blocks" on public.booking_blocks;
create policy "admins manage booking_blocks" on public.booking_blocks
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, delete on public.booking_blocks to authenticated;

-- -----------------------------------------------------------------------------
-- Horas libres (anon + Génesis). Timezone Chile.
-- -----------------------------------------------------------------------------
create or replace function public.list_available_slots(p_days integer default 21)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb := '{}'::jsonb;
  hours text[];
  workdays int[];
  tz text := 'America/Santiago';
  deposit int := 20000;
  d date;
  h text;
  slot timestamptz;
  now_ts timestamptz := now();
  out_slots jsonb := '[]'::jsonb;
  n int;
begin
  p_days := least(greatest(coalesce(p_days, 21), 1), 60);

  select value into settings from public.site_settings where key = 'genesis';
  settings := coalesce(settings, '{}'::jsonb);
  tz := coalesce(settings->>'timezone', 'America/Santiago');
  deposit := coalesce((settings->>'deposit_amount')::int, 20000);

  select coalesce(array_agg(x), array['10:00','12:00','15:00','17:30'])
    into hours
  from (
    select jsonb_array_elements_text(coalesce(settings->'slot_hours', '["10:00","12:00","15:00","17:30"]'::jsonb)) as x
  ) s;

  select coalesce(array_agg(x::int), array[1,2,3,4,5,6])
    into workdays
  from (
    select jsonb_array_elements_text(coalesce(settings->'workdays', '[1,2,3,4,5,6]'::jsonb)) as x
  ) s;

  for n in 0 .. p_days - 1 loop
    d := (now_ts at time zone tz)::date + n;
    if extract(dow from d)::int = any(workdays)
       and not exists (select 1 from public.booking_blocks b where b.day = d)
    then
      foreach h in array hours loop
        slot := ((d::timestamp + h::time) at time zone tz);
        if slot > now_ts
           and not exists (
             select 1 from public.appointments a
             where a.scheduled_at = slot
               and a.status is distinct from 'cancelada'
           )
        then
          out_slots := out_slots || jsonb_build_array(jsonb_build_object(
            'at', slot,
            'date', to_char(d, 'YYYY-MM-DD'),
            'time', h,
            'label', to_char(d, 'DD/MM') || ' ' || h
          ));
        end if;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'timezone', tz,
    'deposit', deposit,
    'hours', to_jsonb(hours),
    'workdays', to_jsonb(workdays),
    'slots', out_slots
  );
end;
$$;

grant execute on function public.list_available_slots(integer) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Reserva pública (web). Génesis sigue usando service role + tools.
-- -----------------------------------------------------------------------------
create or replace function public.book_public_appointment(
  p_name text,
  p_phone text,
  p_scheduled_at timestamptz,
  p_email text default null,
  p_pet_name text default null,
  p_pet_type text default null,
  p_service text default 'Consulta Etología Clínica',
  p_zone text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb := '{}'::jsonb;
  tz text := 'America/Santiago';
  deposit int := 20000;
  min_price int := 40000;
  phone text;
  pet text;
  avail jsonb;
  ok boolean := false;
  item jsonb;
  client_id uuid;
  appt public.appointments%rowtype;
begin
  phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Escribí tu nombre';
  end if;
  if length(phone) < 8 then
    raise exception 'Escribí un teléfono válido';
  end if;
  if p_scheduled_at is null then
    raise exception 'Elegí una hora';
  end if;

  select value into settings from public.site_settings where key = 'genesis';
  settings := coalesce(settings, '{}'::jsonb);
  tz := coalesce(settings->>'timezone', 'America/Santiago');
  deposit := coalesce((settings->>'deposit_amount')::int, 20000);
  min_price := coalesce((settings->>'min_price')::int, 40000);

  if (
    select count(*) from public.appointments
    where regexp_replace(coalesce(client_phone, ''), '\D', '', 'g') = phone
      and created_at > now() - interval '24 hours'
      and status is distinct from 'cancelada'
  ) >= 3 then
    raise exception 'Ya hay reservas recientes con este teléfono. Escribinos por WhatsApp.';
  end if;

  avail := public.list_available_slots(45);
  for item in select jsonb_array_elements(avail->'slots')
  loop
    if date_trunc('minute', (item->>'at')::timestamptz) = date_trunc('minute', p_scheduled_at) then
      ok := true;
      exit;
    end if;
  end loop;
  if not ok then
    raise exception 'Esa hora ya no está disponible. Elegí otra.';
  end if;

  pet := case
    when lower(coalesce(p_pet_type, '')) in ('perro', 'gato', 'otro') then lower(p_pet_type)
    else null
  end;

  select id into client_id from public.clients
    where regexp_replace(coalesce(phone, ''), '\D', '', 'g') = phone
    limit 1;

  if client_id is null then
    insert into public.clients (name, email, phone, pet_name, pet_type, status, channel_slug, last_contact_at)
    values (
      trim(p_name),
      nullif(trim(coalesce(p_email, '')), ''),
      phone,
      nullif(trim(coalesce(p_pet_name, '')), ''),
      pet,
      'agendado',
      'web',
      now()
    )
    returning id into client_id;
  else
    update public.clients
      set name = trim(p_name),
          email = coalesce(nullif(trim(coalesce(p_email, '')), ''), email),
          pet_name = coalesce(nullif(trim(coalesce(p_pet_name, '')), ''), pet_name),
          pet_type = coalesce(pet, pet_type),
          status = 'agendado',
          last_contact_at = now()
      where id = client_id;
  end if;

  insert into public.appointments (
    client_id, client_name, client_email, client_phone,
    pet_name, pet_type, service_title, zone,
    scheduled_at, status, amount, deposit_amount, deposit_paid,
    channel_slug, notes
  ) values (
    client_id,
    trim(p_name),
    nullif(trim(coalesce(p_email, '')), ''),
    phone,
    nullif(trim(coalesce(p_pet_name, '')), ''),
    pet,
    coalesce(nullif(trim(p_service), ''), 'Consulta Etología Clínica'),
    nullif(trim(coalesce(p_zone, '')), ''),
    p_scheduled_at,
    'agendada',
    min_price,
    deposit,
    false,
    'web',
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning * into appt;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', appt.id,
    'scheduled_at', appt.scheduled_at,
    'deposit', deposit,
    'timezone', tz,
    'message', 'Hora reservada. Confirmá con el abono de $' || deposit || ' dentro de 12 horas.'
  );
end;
$$;

grant execute on function public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text) to anon, authenticated;
