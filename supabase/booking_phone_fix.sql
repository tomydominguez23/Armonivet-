-- Fix: column reference "phone" is ambiguous en book_public_appointment
-- SQL Editor → Run (una vez).

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
  min_price int := 38000;
  v_phone text;
  pet text;
  avail jsonb;
  ok boolean := false;
  item jsonb;
  client_id uuid;
  appt public.appointments%rowtype;
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
  settings := coalesce(settings, '{}'::jsonb);
  tz := coalesce(settings->>'timezone', 'America/Santiago');
  deposit := coalesce((settings->>'deposit_amount')::int, 20000);
  min_price := coalesce((settings->>'min_price')::int, 38000);

  if (
    select count(*) from public.appointments
    where regexp_replace(coalesce(client_phone, ''), '\D', '', 'g') = v_phone
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
    'message', 'Hora reservada. Para confirmar, pagá el valor total de la consulta.'
  );
end;
$$;

grant execute on function public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text) to anon, authenticated;
