-- Formulario previo en la web.
-- Correr en el SQL Editor de Supabase después de schema_v2.sql y booking_address.sql.
-- Guarda las respuestas en la ficha del cliente y en intake_forms para que el panel y Génesis las lean.

alter table public.intake_forms add column if not exists appointment_id uuid;

create or replace function public.submit_preconsult_form(
  p_answers jsonb,
  p_appointment_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_form_id uuid;
  v_tutor text;
  v_email text;
  v_phone text;
  v_pet text;
  v_species text;
  v_pet_type text;
  v_profile text;
  v_neutered text;
  v_neutered_bool boolean;
  v_problem text;
  v_context text;
  v_diagnosed text;
  v_meds text;
  v_vet text;
  v_home text;
  v_routine text;
  v_reason text;
  v_extra text;
  v_previous text;
  v_previous_bool boolean;
  v_previous_work text;
begin
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Faltan las respuestas del formulario.';
  end if;

  v_tutor := nullif(trim(coalesce(p_answers->>'tutor_name', '')), '');
  v_email := nullif(trim(coalesce(p_answers->>'email', '')), '');
  v_phone := nullif(trim(coalesce(p_answers->>'phone', '')), '');
  v_pet := nullif(trim(coalesce(p_answers->>'pet_name', '')), '');
  v_species := lower(trim(coalesce(p_answers->>'species', '')));
  v_profile := nullif(trim(coalesce(p_answers->>'patient_profile', '')), '');
  v_neutered := nullif(trim(coalesce(p_answers->>'neutered', '')), '');
  v_problem := nullif(trim(coalesce(p_answers->>'behavior_problem', '')), '');
  v_context := nullif(trim(coalesce(p_answers->>'behavior_context', '')), '');
  v_diagnosed := nullif(trim(coalesce(p_answers->>'diagnosed', '')), '');
  v_meds := nullif(trim(coalesce(p_answers->>'medications', '')), '');
  v_vet := nullif(trim(coalesce(p_answers->>'previous_vet', '')), '');
  v_home := nullif(trim(coalesce(p_answers->>'household', '')), '');
  v_routine := nullif(trim(coalesce(p_answers->>'routine', '')), '');
  v_reason := nullif(trim(coalesce(p_answers->>'consultation_reason', '')), '');
  v_extra := nullif(trim(coalesce(p_answers->>'extra', '')), '');
  v_previous := lower(trim(coalesce(p_answers->>'previous_ethologist', '')));
  v_previous_work := nullif(trim(coalesce(p_answers->>'previous_work', '')), '');

  if v_tutor is null or v_email is null or v_phone is null or v_pet is null or v_reason is null then
    raise exception 'Completa los datos del tutor, el paciente y el motivo de la consulta.';
  end if;

  v_pet_type := case
    when v_species in ('canino', 'perro') then 'perro'
    when v_species in ('felino', 'gato') then 'gato'
    else 'otro'
  end;
  v_neutered_bool := case
    when v_neutered ~* '^(s[ií]\M)' then true
    when v_neutered ~* '^no\M' then false
    else null
  end;
  v_previous_bool := case
    when v_previous in ('si', 'sí', 'yes') then true
    when v_previous = 'no' then false
    else null
  end;

  if p_appointment_id is not null then
    select a.client_id into v_client_id
    from public.appointments a
    where a.id = p_appointment_id;
  end if;

  if v_client_id is null then
    select c.id into v_client_id
    from public.clients c
    where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1;
  end if;

  if v_client_id is null then
    select c.id into v_client_id
    from public.clients c
    where lower(coalesce(c.email, '')) = lower(v_email)
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1;
  end if;

  if v_client_id is null then
    insert into public.clients (
      name, tutor_name, email, phone, pet_name, pet_type, pet_age,
      is_neutered, neutered_date, diagnosed_conditions, current_treatment,
      household_members, consultation_reason, behavior_frequency,
      previous_ethologist, attempted_solutions, last_vet_reason,
      time_spent_location, life_changes, status, channel_slug, last_contact_at
    ) values (
      v_tutor, v_tutor, v_email, v_phone, v_pet, v_pet_type, v_profile,
      v_neutered_bool, v_neutered, v_diagnosed, v_meds,
      v_home, v_reason, v_context,
      v_previous_bool, coalesce(v_previous_work, v_problem), v_vet,
      v_routine, v_extra, 'agendado', 'web', now()
    )
    returning id into v_client_id;
  else
    update public.clients
      set name = v_tutor,
          tutor_name = v_tutor,
          email = v_email,
          phone = v_phone,
          pet_name = v_pet,
          pet_type = v_pet_type,
          pet_age = coalesce(v_profile, pet_age),
          is_neutered = coalesce(v_neutered_bool, is_neutered),
          neutered_date = coalesce(v_neutered, neutered_date),
          diagnosed_conditions = coalesce(v_diagnosed, diagnosed_conditions),
          current_treatment = coalesce(v_meds, current_treatment),
          household_members = coalesce(v_home, household_members),
          consultation_reason = coalesce(v_reason, consultation_reason),
          behavior_frequency = coalesce(v_context, behavior_frequency),
          previous_ethologist = coalesce(v_previous_bool, previous_ethologist),
          attempted_solutions = coalesce(v_previous_work, v_problem, attempted_solutions),
          last_vet_reason = coalesce(v_vet, last_vet_reason),
          time_spent_location = coalesce(v_routine, time_spent_location),
          life_changes = coalesce(v_extra, life_changes),
          last_contact_at = now()
      where id = v_client_id;
  end if;

  insert into public.intake_forms (
    client_id, appointment_id, email, patient_name, tutor_info, patient_data,
    is_neutered, diagnosed_conditions, household_members, consultation_reason,
    behavior_timing, previous_ethologist, attempted_solutions, last_vet_visit,
    housing_info, life_changes, completed, raw_answers
  ) values (
    v_client_id,
    p_appointment_id,
    v_email,
    v_pet,
    v_tutor,
    v_profile,
    v_neutered,
    v_diagnosed,
    v_home,
    v_reason,
    v_context,
    case when v_previous_bool is true then 'Sí' when v_previous_bool is false then 'No' else v_previous end,
    coalesce(v_previous_work, v_problem),
    v_vet,
    v_routine,
    v_extra,
    true,
    p_answers || jsonb_build_object('behavior_problem', coalesce(v_problem, ''))
  )
  returning id into v_form_id;

  return jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,
    'form_id', v_form_id
  );
end;
$$;

grant execute on function public.submit_preconsult_form(jsonb, uuid) to anon, authenticated;
