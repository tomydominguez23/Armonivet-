-- =============================================================================
-- Armonivet · Guarda la dirección del cliente al reservar por la web
-- SQL Editor de Supabase. Corre este archivo después de payment_holds.sql.
--
-- Qué hace:
--   * Acepta p_address en book_public_appointment
--   * Lo guarda en clients.address
--   * También queda en appointments.notes (junto con el motivo)
-- =============================================================================

drop function if exists public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text);
drop function if exists public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text, integer);
drop function if exists public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text, integer, text);

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
  p_amount integer default null,
  p_address text default null
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
  v_address text;
  v_notes text;
begin
  v_phone := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_address := nullif(trim(coalesce(p_address, '')), '');
  v_notes := nullif(trim(coalesce(p_notes, '')), '');
  if v_address is not null and (v_notes is null or position(lower(v_address) in lower(v_notes)) = 0) then
    v_notes := trim(concat_ws(' · ', 'Dirección: ' || v_address, v_notes));
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Escribe tu nombre';
  end if;
  if length(v_phone) < 8 then
    raise exception 'Escribe un teléfono válido';
  end if;
  if p_scheduled_at is null then
    raise exception 'Elige una hora';
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
    raise exception 'Esa hora ya no está disponible para % . Elige otra.', v_mode;
  end if;

  pet := case
    when lower(coalesce(p_pet_type, '')) in ('perro', 'gato', 'otro') then lower(p_pet_type)
    else null
  end;

  select c.id into client_id from public.clients c
    where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone
    limit 1;

  if client_id is null then
    insert into public.clients (name, email, phone, address, pet_name, pet_type, status, channel_slug, last_contact_at)
    values (
      trim(p_name),
      nullif(trim(coalesce(p_email, '')), ''),
      v_phone,
      v_address,
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
          address = coalesce(v_address, address),
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
    v_notes
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

grant execute on function public.book_public_appointment(text, text, timestamptz, text, text, text, text, text, text, integer, text) to anon, authenticated;
