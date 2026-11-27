-- Candado para que Génesis responda un turno a la vez por conversación.
-- Evita respuestas duplicadas cuando el cliente manda varios mensajes seguidos
-- o cuando Wazend reintenta el webhook. Ejecutar una vez en SQL Editor.
-- Es seguro correrlo más de una vez.

alter table public.wa_conversations
  add column if not exists genesis_lock_until timestamptz;

-- Devuelve true solo a quien se queda con el candado. Es un único UPDATE
-- condicionado: si llegan dos webhooks a la vez, el segundo espera la fila,
-- vuelve a evaluar la condición y ya no la cumple, así que recibe false.
-- El candado vence solo (p_seconds) por si la función se cae a mitad de turno.
create or replace function public.genesis_try_lock(p_conversation uuid, p_seconds integer default 120)
returns boolean
language sql
security definer
set search_path = public
as $$
  with claimed as (
    update public.wa_conversations
       set genesis_lock_until = now() + make_interval(secs => greatest(p_seconds, 1))
     where id = p_conversation
       and (genesis_lock_until is null or genesis_lock_until < now())
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.genesis_try_lock(uuid, integer) from public;
revoke all on function public.genesis_try_lock(uuid, integer) from anon, authenticated;
grant execute on function public.genesis_try_lock(uuid, integer) to service_role;

-- Para que PostgREST vea la columna y la función nuevas sin esperar.
notify pgrst, 'reload schema';
