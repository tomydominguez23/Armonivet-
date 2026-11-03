-- =============================================================================
-- Armonivet · Reagendar desde la tabla de citas
-- SQL Editor, después de payment_holds.sql.
--
-- Al mover una cita (por ejemplo de 15:00 a 15:30):
--   * la hora anterior deja de estar ocupada
--   * la nueva queda bloqueada en el calendario de la web
--   * no se puede pisar otra cita que ya ocupa ese tramo
-- =============================================================================

alter table public.appointments
  add column if not exists slot_locked_at timestamptz;

create or replace function public.appointment_blocks_calendar(p public.appointments)
returns boolean
language sql
stable
as $$
  select p.status is distinct from 'cancelada'
    and (
      p.slot_locked_at is not null
      or not (
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
      )
    );
$$;

create or replace function public.reschedule_appointment(
  p_id uuid,
  p_scheduled_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  appt public.appointments%rowtype;
  previous_at timestamptz;
  genesis jsonb := '{}'::jsonb;
  calendar jsonb := '{}'::jsonb;
  use_calendar boolean := false;
  tz text := 'America/Santiago';
  dur int := 60;
  dur_online int := 60;
  dur_presencial int := 60;
  block_len int := 60;
  buf_before int := 0;
  buf_after int := 0;
  max_day int := 0;
  v_mode text;
  blob text;
  other_name text;
  day_count int;
  old_day date;
  new_day date;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  if p_id is null or p_scheduled_at is null then
    raise exception 'Falta la cita o la nueva hora';
  end if;

  select * into appt from public.appointments where id = p_id for update;
  if not found then
    raise exception 'No encontramos esa cita';
  end if;
  if appt.status = 'cancelada' then
    raise exception 'Esta cita está cancelada. Creá una nueva si hay que reagendarla.';
  end if;

  previous_at := appt.scheduled_at;
  p_scheduled_at := date_trunc('minute', p_scheduled_at);
  -- Una sola mudanza a la vez, para que dos cambios no ocupen el mismo tramo.
  perform pg_advisory_xact_lock(hashtext('armonivet-reschedule'));

  if previous_at is not null and date_trunc('minute', previous_at) = p_scheduled_at then
    update public.appointments
      set slot_locked_at = coalesce(slot_locked_at, now())
      where id = p_id
      returning * into appt;
    return jsonb_build_object(
      'ok', true,
      'unchanged', true,
      'appointment_id', appt.id,
      'scheduled_at', appt.scheduled_at
    );
  end if;

  select value into genesis from public.site_settings where key = 'genesis';
  select value into calendar from public.site_settings where key = 'calendar';
  genesis := coalesce(genesis, '{}'::jsonb);
  calendar := coalesce(calendar, '{}'::jsonb);
  use_calendar := calendar ? 'online' or calendar ? 'presencial';
  tz := coalesce(nullif(calendar->>'timezone', ''), genesis->>'timezone', 'America/Santiago');

  blob := lower(coalesce(appt.service_title, '') || ' ' || coalesce(appt.zone, ''));
  if blob like '%online%' or blob like '%remot%' then
    v_mode := 'online';
  else
    v_mode := 'presencial';
  end if;

  if use_calendar then
    dur_online := least(greatest(coalesce((calendar->'online'->>'duration_minutes')::int, 60), 5), 480);
    dur_presencial := least(greatest(coalesce((calendar->'presencial'->>'duration_minutes')::int, 60), 5), 480);
    block_len := greatest(dur_online, dur_presencial);
    dur := case when v_mode = 'online' then dur_online else dur_presencial end;
    buf_before := least(greatest(coalesce((calendar->>'buffer_before_minutes')::int, 0), 0), 240);
    buf_after := least(greatest(coalesce((calendar->>'buffer_after_minutes')::int, 0), 0), 240);
    max_day := least(greatest(coalesce((calendar->>'max_per_day')::int, 0), 0), 50);

    select a.client_name into other_name
    from public.appointments a
    where a.id <> p_id
      and public.appointment_blocks_calendar(a)
      and a.scheduled_at < p_scheduled_at + make_interval(mins => dur + buf_after + buf_before)
      and a.scheduled_at + make_interval(mins => block_len + buf_after + buf_before) > p_scheduled_at
    limit 1;

    if other_name is not null then
      raise exception 'Esa hora se cruza con la cita de %. Elegí otro horario.', other_name;
    end if;

    if max_day > 0 then
      old_day := (previous_at at time zone tz)::date;
      new_day := (p_scheduled_at at time zone tz)::date;
      if old_day is distinct from new_day then
        select count(*) into day_count
        from public.appointments a
        where a.id <> p_id
          and public.appointment_blocks_calendar(a)
          and (a.scheduled_at at time zone tz)::date = new_day;
        if day_count >= max_day then
          raise exception 'Ese día ya llegó al máximo de citas.';
        end if;
      end if;
    end if;
  else
    select a.client_name into other_name
    from public.appointments a
    where a.id <> p_id
      and public.appointment_blocks_calendar(a)
      and date_trunc('minute', a.scheduled_at) = p_scheduled_at
    limit 1;
    if other_name is not null then
      raise exception 'Esa hora ya la tiene %. Elegí otro horario.', other_name;
    end if;
  end if;

  update public.appointments
    set scheduled_at = p_scheduled_at,
        slot_locked_at = now()
    where id = p_id
    returning * into appt;

  return jsonb_build_object(
    'ok', true,
    'appointment_id', appt.id,
    'scheduled_at', appt.scheduled_at,
    'previous_at', previous_at,
    'mode', v_mode
  );
end;
$$;

revoke all on function public.reschedule_appointment(uuid, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz) to authenticated;
