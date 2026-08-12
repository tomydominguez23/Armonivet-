-- =============================================================================
-- Armonivet · Funciones RPC de estadísticas (opcional pero recomendado)
-- =============================================================================

create or replace function public.admin_dashboard_stats(days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  since timestamptz := now() - make_interval(days => greatest(days, 1));
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'visits_unique', (
      select count(*) from public.page_visits
      where created_at >= since and is_unique_session = true
    ),
    'visits_total', (
      select count(*) from public.page_visits where created_at >= since
    ),
    'click_agendar', (
      select count(*) from public.conversion_events
      where created_at >= since and event_type = 'click_agendar'
    ),
    'appointments', (
      select count(*) from public.appointments
      where created_at >= since and status <> 'cancelada'
    ),
    'paid', (
      select count(*) from public.appointments
      where created_at >= since and (deposit_paid = true or status in ('abonada', 'llegó', 'completada'))
    ),
    'arrived', (
      select count(*) from public.appointments
      where created_at >= since and status in ('llegó', 'completada')
    ),
    'revenue_estimated', (
      select coalesce(sum(amount), 0) from public.appointments
      where created_at >= since and status in ('abonada', 'llegó', 'completada')
    ),
    'by_channel', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          coalesce(nullif(channel_slug, ''), 'directo') as channel,
          count(*) filter (where is_unique_session) as unique_visits
        from public.page_visits
        where created_at >= since
        group by 1
        order by unique_visits desc
        limit 12
      ) t
    ),
    'visits_by_day', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select
          date_trunc('day', created_at)::date as day,
          count(*) filter (where is_unique_session) as unique_visits,
          count(*) as hits
        from public.page_visits
        where created_at >= since
        group by 1
        order by 1
      ) t
    ),
    'appointments_by_status', (
      select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      from (
        select status, count(*) as total
        from public.appointments
        where created_at >= since
        group by status
        order by total desc
      ) t
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_dashboard_stats(integer) from public;
grant execute on function public.admin_dashboard_stats(integer) to authenticated;
