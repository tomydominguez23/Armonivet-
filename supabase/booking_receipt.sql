-- =============================================================================
-- Armonivet · Comprobante público después del pago
-- SQL Editor, después de checkout.sql.
-- Devuelve solo servicio, día/hora y monto. No incluye teléfono, correo ni dirección.
-- El id del pago (UUID) viaja en la vuelta de Mercado Pago y no se puede adivinar.
-- =============================================================================

create or replace function public.booking_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pay public.payments%rowtype;
  appt public.appointments%rowtype;
  service_name text;
begin
  if p_payment_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into pay from public.payments where id = p_payment_id;
  if not found or pay.status in ('cancelado', 'vencido') then
    return jsonb_build_object('ok', false);
  end if;

  if pay.appointment_id is not null then
    select * into appt from public.appointments where id = pay.appointment_id;
  end if;

  service_name := nullif(trim(coalesce(appt.service_title, '')), '');
  if service_name is null and jsonb_typeof(pay.items) = 'array' then
    select nullif(trim(coalesce(item->>'title', '')), '')
      into service_name
    from jsonb_array_elements(pay.items) as item
    where nullif(trim(coalesce(item->>'title', '')), '') is not null
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'service', coalesce(service_name, 'Consulta'),
    'when', case when appt.id is not null and appt.status is distinct from 'cancelada' then appt.scheduled_at else null end,
    'amount', coalesce(pay.amount, appt.amount, 0),
    'appointment_id', appt.id
  );
end;
$$;

revoke all on function public.booking_receipt(uuid) from public;
grant execute on function public.booking_receipt(uuid) to anon, authenticated;
