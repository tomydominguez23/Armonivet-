-- =============================================================================
-- Armonivet · Pagos: monto real, comprobante y hora que se libera
-- SQL Editor de Supabase, después de calendar_settings.sql.
-- Podés correr este archivo solo: vuelve a crear las funciones de la agenda
-- con la reserva web en pendiente_pago (20 minutos).
--
-- Qué hace con los datos que ya existen:
--   * Si hay un pago en estado pagado, la cita queda con ESE monto.
--   * Si la cita sigue en 0, 38000 o 40000 y nadie pagó, se estima el precio
--     del servicio (así no quedan todas en $38.000).
--   * Las reservas web en "agendada", sin pago, de más de 20 minutos, pasan
--     a cancelada y la hora queda libre.
--   * Las citas de WhatsApp u otras creadas a mano (canal distinto de web)
--     no se cancelan. Las que ya están abonadas tampoco.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'appointments'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%agendada%'
  loop
    execute format('alter table public.appointments drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.appointments
  add constraint appointments_status_check
  check (status in ('agendada', 'pendiente_pago', 'abonada', 'llegó', 'completada', 'cancelada', 'no_asistió'));

alter table public.payments
  add column if not exists receipt_sent_at timestamptz;

-- El resto (bloqueo de hora, vencimiento y reserva) sigue en calendar_settings.sql
-- y se repite abajo para que este script alcance por sí solo.

-- Una reserva de la web bloquea la hora solo mientras el pago está en curso.
create or replace function public.appointment_blocks_calendar(p public.appointments)
returns boolean
language sql
stable
as $$
  select p.status is distinct from 'cancelada'
    and not (
      p.deposit_paid is not true
      and p.created_at < now() - interval '20 minutes'
      and (
        p.status = 'pendiente_pago'
        or (p.status = 'agendada' and coalesce(p.channel_slug, '') = 'web')
      )
      and not exists (
        select 1 from public.payments pay
        where pay.appointment_id = p.id
          and pay.status = 'pagado'
      )
    );
$$;

create or replace function public.expire_unpaid_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.appointments
    set status = 'cancelada',
        notes = trim(concat_ws(' ', notes, 'Pago no completado: la hora volvió a quedar libre.'))
  where deposit_paid is not true
    and created_at < now() - interval '20 minutes'
    and (
      status = 'pendiente_pago'
      or (status = 'agendada' and coalesce(channel_slug, '') = 'web')
    )
    and not exists (
      select 1 from public.payments pay
      where pay.appointment_id = appointments.id
        and pay.status = 'pagado'
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

drop function if exists public.list_available_slots(integer);

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
  genesis jsonb := '{}'::jsonb;
  calendar jsonb := '{}'::jsonb;
  use_calendar boolean := false;
  hours_online text[] := array[]::text[];
  hours_presencial text[] := array[]::text[];
  days_online int[] := array[]::int[];
  days_presencial int[] := array[]::int[];
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
  mode_name text;
  want text;
  window_days int := 45;
  notice_mins int := 0;
  inc_global int := 0;
  buf_before int := 0;
  buf_after int := 0;
  max_day int := 0;
  dur int := 60;
  dur_online int := 60;
  dur_presencial int := 60;
  block_len int := 60;
  inc int := 60;
  day_count int := 0;
  dow_key text;
  ranges_json jsonb;
  range_item jsonb;
  item jsonb;
  chosen jsonb;
  fallback jsonb;
  skip_day boolean;
  start_min int;
  end_min int;
  cursor_min int;
  time_txt text;
  emitted int;
  name_online text := 'Consulta online';
  name_presencial text := 'Consulta presencial';
begin
  want := nullif(lower(trim(coalesce(p_mode, ''))), '');
  if want in ('todas', 'all', '*') then
    want := null;
  end if;

  select value into genesis from public.site_settings where key = 'genesis';
  select value into calendar from public.site_settings where key = 'calendar';
  genesis := coalesce(genesis, '{}'::jsonb);
  calendar := coalesce(calendar, '{}'::jsonb);
  use_calendar := calendar ? 'online' or calendar ? 'presencial';
  perform public.expire_unpaid_holds();

  tz := coalesce(nullif(calendar->>'timezone', ''), genesis->>'timezone', 'America/Santiago');
  deposit := coalesce((genesis->>'deposit_amount')::int, 20000);

  if not use_calendar then
    p_days := least(greatest(coalesce(p_days, 21), 1), 60);
    window_days := p_days;

    select coalesce(array_agg(x), array['10:00','12:00'])
      into hours_online
    from (
      select jsonb_array_elements_text(
        coalesce(genesis->'slot_hours_online', genesis->'slot_hours', '["10:00","12:00"]'::jsonb)
      ) as x
    ) s;

    select coalesce(array_agg(x), array['15:00','17:30'])
      into hours_presencial
    from (
      select jsonb_array_elements_text(
        coalesce(genesis->'slot_hours_presencial', genesis->'slot_hours', '["15:00","17:30"]'::jsonb)
      ) as x
    ) s;

    select coalesce(array_agg(x::int), array[1,2,3,4,5])
      into days_online
    from (
      select jsonb_array_elements_text(
        coalesce(genesis->'workdays_online', genesis->'workdays', '[1,2,3,4,5]'::jsonb)
      ) as x
    ) s;

    select coalesce(array_agg(x::int), array[1,2,3,4,5,6])
      into days_presencial
    from (
      select jsonb_array_elements_text(
        coalesce(genesis->'workdays_presencial', genesis->'workdays', '[1,2,3,4,5,6]'::jsonb)
      ) as x
    ) s;

    foreach mode_name in array array['online','presencial'] loop
      if want is not null and want is distinct from mode_name then
        continue;
      end if;
      if mode_name = 'online' then
        hours := hours_online;
        workdays := days_online;
      else
        hours := hours_presencial;
        workdays := days_presencial;
      end if;

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
                   and public.appointment_blocks_calendar(a)
               )
            then
              out_slots := out_slots || jsonb_build_array(jsonb_build_object(
                'at', slot,
                'date', to_char(d, 'YYYY-MM-DD'),
                'time', h,
                'mode', mode_name,
                'label', to_char(d, 'DD/MM') || ' ' || h
              ));
            end if;
          end loop;
        end if;
      end loop;
    end loop;
  else
    window_days := least(greatest(coalesce((calendar->>'window_days')::int, 45), 1), 180);
    p_days := least(greatest(coalesce(p_days, window_days), 1), window_days);
    notice_mins := least(greatest(coalesce((calendar->>'min_notice_minutes')::int, 0), 0), 60 * 24 * 90);
    inc_global := coalesce((calendar->>'increment_minutes')::int, 0);
    if inc_global < 0 then inc_global := 0; end if;
    if inc_global > 0 and inc_global < 5 then inc_global := 5; end if;
    if inc_global > 240 then inc_global := 240; end if;
    buf_before := least(greatest(coalesce((calendar->>'buffer_before_minutes')::int, 0), 0), 240);
    buf_after := least(greatest(coalesce((calendar->>'buffer_after_minutes')::int, 0), 0), 240);
    max_day := least(greatest(coalesce((calendar->>'max_per_day')::int, 0), 0), 50);

    dur_online := least(greatest(coalesce((calendar->'online'->>'duration_minutes')::int, 60), 5), 480);
    dur_presencial := least(greatest(coalesce((calendar->'presencial'->>'duration_minutes')::int, 60), 5), 480);
    block_len := greatest(dur_online, dur_presencial);
    name_online := coalesce(nullif(trim(calendar->'online'->>'name'), ''), 'Consulta online');
    name_presencial := coalesce(nullif(trim(calendar->'presencial'->>'name'), ''), 'Consulta presencial');

    if jsonb_typeof(calendar->'online'->'weekly') = 'object' then
      select coalesce(array_agg(k::int order by k::int), array[]::int[])
        into days_online
      from jsonb_object_keys(calendar->'online'->'weekly') as k
      where jsonb_typeof(calendar->'online'->'weekly'->k) = 'array'
        and jsonb_array_length(calendar->'online'->'weekly'->k) > 0;
    end if;

    if jsonb_typeof(calendar->'presencial'->'weekly') = 'object' then
      select coalesce(array_agg(k::int order by k::int), array[]::int[])
        into days_presencial
      from jsonb_object_keys(calendar->'presencial'->'weekly') as k
      where jsonb_typeof(calendar->'presencial'->'weekly'->k) = 'array'
        and jsonb_array_length(calendar->'presencial'->'weekly'->k) > 0;
    end if;

    foreach mode_name in array array['online','presencial'] loop
      if want is not null and want is distinct from mode_name then
        continue;
      end if;
      if coalesce(calendar->mode_name->>'enabled', 'true') in ('false', 'f', '0') then
        continue;
      end if;

      dur := case when mode_name = 'online' then dur_online else dur_presencial end;
      inc := case when inc_global >= 5 then inc_global else dur end;

      for n in 0 .. p_days - 1 loop
        exit when jsonb_array_length(out_slots) >= 4000;
        d := (now_ts at time zone tz)::date + n;
        if exists (select 1 from public.booking_blocks b where b.day = d) then
          continue;
        end if;

        if max_day > 0 then
          select count(*) into day_count
          from public.appointments a
          where public.appointment_blocks_calendar(a)
            and (a.scheduled_at at time zone tz)::date = d;
          if day_count >= max_day then
            continue;
          end if;
        end if;

        dow_key := extract(dow from d)::int::text;
        ranges_json := coalesce(calendar->mode_name->'weekly'->dow_key, '[]'::jsonb);
        chosen := null;
        fallback := null;
        for item in select jsonb_array_elements(coalesce(calendar->'date_overrides', '[]'::jsonb))
        loop
          if coalesce(item->>'date', '') = to_char(d, 'YYYY-MM-DD')
             and coalesce(item->>'mode', 'ambas') in ('ambas', mode_name)
          then
            if coalesce(item->>'mode', 'ambas') = mode_name then
              chosen := item;
            else
              fallback := item;
            end if;
          end if;
        end loop;
        chosen := coalesce(chosen, fallback);
        skip_day := false;
        if chosen is not null then
          if coalesce(chosen->>'closed', 'false') in ('true', 't', '1') then
            skip_day := true;
          else
            ranges_json := coalesce(chosen->'ranges', '[]'::jsonb);
          end if;
        end if;
        if skip_day or jsonb_typeof(ranges_json) is distinct from 'array' then
          continue;
        end if;

        emitted := 0;
        for range_item in select jsonb_array_elements(ranges_json)
        loop
          exit when emitted >= 48;
          if coalesce(range_item->>'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
            continue;
          end if;
          if coalesce(range_item->>'end', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
            continue;
          end if;
          start_min := split_part(range_item->>'start', ':', 1)::int * 60
            + split_part(range_item->>'start', ':', 2)::int;
          end_min := split_part(range_item->>'end', ':', 1)::int * 60
            + split_part(range_item->>'end', ':', 2)::int;
          cursor_min := start_min;
          while cursor_min + dur <= end_min and emitted < 48 loop
            time_txt := lpad((cursor_min / 60)::text, 2, '0') || ':' || lpad((cursor_min % 60)::text, 2, '0');
            slot := ((d::timestamp + time_txt::time) at time zone tz);
            if slot > now_ts + make_interval(mins => notice_mins)
               and not exists (
                 select 1 from public.appointments a
                 where public.appointment_blocks_calendar(a)
                   and a.scheduled_at < slot + make_interval(mins => dur + buf_after + buf_before)
                   and a.scheduled_at + make_interval(mins => block_len + buf_after + buf_before) > slot
               )
            then
              out_slots := out_slots || jsonb_build_array(jsonb_build_object(
                'at', slot,
                'date', to_char(d, 'YYYY-MM-DD'),
                'time', time_txt,
                'mode', mode_name,
                'label', to_char(d, 'DD/MM') || ' ' || time_txt
              ));
              if mode_name = 'online' then
                if not time_txt = any(hours_online) then
                  hours_online := hours_online || time_txt;
                end if;
              elsif not time_txt = any(hours_presencial) then
                hours_presencial := hours_presencial || time_txt;
              end if;
              emitted := emitted + 1;
            end if;
            cursor_min := cursor_min + inc;
          end loop;
        end loop;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'timezone', tz,
    'deposit', deposit,
    'window_days', window_days,
    'min_notice_minutes', notice_mins,
    'increment_minutes', inc_global,
    'duration_online', dur_online,
    'duration_presencial', dur_presencial,
    'name_online', name_online,
    'name_presencial', name_presencial,
    'hours_online', to_jsonb(coalesce(hours_online, array[]::text[])),
    'hours_presencial', to_jsonb(coalesce(hours_presencial, array[]::text[])),
    'workdays_online', to_jsonb(coalesce(days_online, array[]::int[])),
    'workdays_presencial', to_jsonb(coalesce(days_presencial, array[]::int[])),
    'hours', to_jsonb(coalesce(hours_presencial, array[]::text[])),
    'workdays', to_jsonb(coalesce(days_presencial, array[]::int[])),
    'slots', out_slots
  );
end;
$$;

grant execute on function public.list_available_slots(integer, text) to anon, authenticated;

drop function if exists public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text);
drop function if exists public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text, integer);

create or replace function public.book_public_appointment(
  p_name text,
  p_phone text,
  p_scheduled_at timestamptz,
  p_email text default null,
  p_pet_name text default null,
  p_pet_type text default null,
  p_service text default 'Consulta Etología Clínica',
  p_zone text default null,
  p_notes text default null,
  p_amount integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb := '{}'::jsonb;
  calendar jsonb := '{}'::jsonb;
  tz text := 'America/Santiago';
  deposit int := 20000;
  min_price int := 38000;
  v_amount int := 38000;
  v_phone text;
  pet text;
  avail jsonb;
  ok boolean := false;
  item jsonb;
  client_id uuid;
  appt public.appointments%rowtype;
  v_mode text;
  blob text;
  msg text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Escribí tu nombre';
  end if;
  if length(v_phone) < 8 then
    raise exception 'Escribí un teléfono válido';
  end if;
  if p_scheduled_at is null then
    raise exception 'Elegí una hora';
  end if;

  select value into settings from public.site_settings where key = 'genesis';
  select value into calendar from public.site_settings where key = 'calendar';
  settings := coalesce(settings, '{}'::jsonb);
  calendar := coalesce(calendar, '{}'::jsonb);
  tz := coalesce(nullif(calendar->>'timezone', ''), settings->>'timezone', 'America/Santiago');
  deposit := coalesce((settings->>'deposit_amount')::int, 20000);
  min_price := coalesce((settings->>'min_price')::int, 38000);
  if p_amount is not null and p_amount >= 1000 then
    v_amount := p_amount;
  else
    v_amount := min_price;
  end if;
  msg := nullif(trim(coalesce(calendar->>'confirmation_message', '')), '');
  msg := trim(concat_ws(' ',
    coalesce(msg, 'Te guardamos la hora por 20 minutos.'),
    'Si el pago no se completa, el horario se libera.'
  ));

  blob := lower(coalesce(p_service, '') || ' ' || coalesce(p_zone, ''));
  if blob like '%online%' or blob like '%remot%' then
    v_mode := 'online';
  else
    v_mode := 'presencial';
  end if;

  if (
    select count(*) from public.appointments
    where regexp_replace(coalesce(client_phone, ''), '\D', '', 'g') = v_phone
      and created_at > now() - interval '24 hours'
      and status is distinct from 'cancelada'
  ) >= 3 then
    raise exception 'Ya hay reservas recientes con este teléfono. Escribinos por WhatsApp.';
  end if;

  avail := public.list_available_slots(180, v_mode);
  for item in select jsonb_array_elements(avail->'slots')
  loop
    if date_trunc('minute', (item->>'at')::timestamptz) = date_trunc('minute', p_scheduled_at) then
      ok := true;
      exit;
    end if;
  end loop;
  if not ok then
    raise exception 'Esa hora ya no está disponible para % . Elegí otra.', v_mode;
  end if;

  pet := case
    when lower(coalesce(p_pet_type, '')) in ('perro', 'gato', 'otro') then lower(p_pet_type)
    else null
  end;

  select c.id into client_id from public.clients c
    where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone
    limit 1;

  if client_id is null then
    insert into public.clients (name, email, phone, pet_name, pet_type, status, channel_slug, last_contact_at)
    values (
      trim(p_name),
      nullif(trim(coalesce(p_email, '')), ''),
      v_phone,
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
    v_phone,
    nullif(trim(coalesce(p_pet_name, '')), ''),
    pet,
    coalesce(nullif(trim(p_service), ''), 'Consulta Etología Clínica'),
    nullif(trim(coalesce(p_zone, '')), ''),
    p_scheduled_at,
    'pendiente_pago',
    v_amount,
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
    'mode', v_mode,
    'deposit', deposit,
    'amount', appt.amount,
    'status', appt.status,
    'timezone', tz,
    'message', msg
  );
end;
$$;

grant execute on function public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text, integer) to anon, authenticated;

create or replace function public.release_unpaid_hold(p_appointment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_appointment_id is null then
    return jsonb_build_object('ok', false, 'released', false);
  end if;

  update public.appointments a
    set status = 'cancelada',
        notes = trim(concat_ws(' ', a.notes, 'Pago no completado: la hora volvió a quedar libre.'))
  where a.id = p_appointment_id
    and a.deposit_paid is not true
    and (
      a.status = 'pendiente_pago'
      or (a.status = 'agendada' and coalesce(a.channel_slug, '') = 'web')
    )
    and not exists (
      select 1 from public.payments p
      where p.appointment_id = a.id
        and p.status = 'pagado'
    );
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'released', n > 0);
end;
$$;

grant execute on function public.release_unpaid_hold(uuid) to anon, authenticated;

-- Montos que quedaron en el mínimo de Génesis o en el valor por defecto del admin.
update public.appointments set amount = case
  when lower(coalesce(service_title, '')) like '%pack seguimiento%' then 155000
  when lower(coalesce(service_title, '')) like '%pack continuidad%' then 120000
  when lower(coalesce(service_title, '')) like '%pack acompañ%' or lower(coalesce(service_title, '')) like '%pack acompan%' then 98000
  when lower(coalesce(service_title, '')) like '%pack inicio%' then 84000
  when lower(coalesce(service_title, '')) like '%control%' and (lower(service_title) like '%remot%' or lower(service_title) like '%online%' or lower(coalesce(zone, '')) = 'online') then 38000
  when lower(coalesce(service_title, '')) like '%control%' and lower(coalesce(zone, '')) like '%sector c%' then 55000
  when lower(coalesce(service_title, '')) like '%control%' then 50000
  when lower(service_title) like '%remot%' or lower(service_title) like '%online%' or lower(coalesce(zone, '')) = 'online' then 50000
  when lower(service_title) like '%entren%' or lower(service_title) like '%cachorr%' or lower(service_title) like '%educaci%' then 45000
  when lower(coalesce(zone, '')) like '%sector c%' then 70000
  else 65000 end
where coalesce(amount, 0) in (0, 38000, 40000)
  and status is distinct from 'cancelada'
  and not exists (
    select 1 from public.payments p
    where p.appointment_id = appointments.id
      and p.status = 'pagado'
  );

-- El monto cobrado gana sobre el precio de lista.
update public.appointments a
set amount = paid.amount
from (
  select distinct on (p.appointment_id)
    p.appointment_id,
    p.amount
  from public.payments p
  where p.status = 'pagado'
    and p.appointment_id is not null
    and coalesce(p.amount, 0) > 0
  order by p.appointment_id, p.paid_at desc nulls last, p.created_at desc
) paid
where a.id = paid.appointment_id
  and a.amount is distinct from paid.amount;

-- Reservas web que quedaron tomadas sin pago. No toca WhatsApp ni abonadas.
update public.appointments a
set status = 'cancelada',
    notes = trim(concat_ws(' ', a.notes, 'La hora se liberó porque el pago no se completó.'))
where a.channel_slug = 'web'
  and a.status = 'agendada'
  and a.deposit_paid is not true
  and a.created_at < now() - interval '20 minutes'
  and not exists (
    select 1 from public.payments p
    where p.appointment_id = a.id
      and p.status = 'pagado'
  );
