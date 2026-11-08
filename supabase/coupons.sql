-- =============================================================================
-- Armonivet · Cupones de descuento
-- SQL Editor, después de checkout.sql.
-- El panel crea los códigos. El pago vuelve a calcular el descuento en el servidor.
-- =============================================================================

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null default 'Descuento',
  percent integer,
  amount_off integer,
  applies_to text not null default 'control' check (applies_to in ('control', 'all')),
  max_uses integer,
  expires_on date,
  pitch text,
  review_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_discount_check check (
    (percent is not null and percent between 1 and 90 and amount_off is null)
    or (amount_off is not null and amount_off between 1000 and 500000 and percent is null)
  ),
  constraint coupons_max_uses_check check (max_uses is null or max_uses >= 1)
);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  payment_id uuid not null unique references public.payments (id) on delete cascade,
  status text not null default 'reservado' check (status in ('reservado', 'usado', 'liberado')),
  amount_before integer not null,
  discount integer not null,
  amount_after integer not null,
  created_at timestamptz not null default now()
);

create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, status, created_at);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists "admins manage coupons" on public.coupons;
create policy "admins manage coupons" on public.coupons
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins read coupon redemptions" on public.coupon_redemptions;
create policy "admins read coupon redemptions" on public.coupon_redemptions
  for select to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;

create or replace function public.coupon_compute(
  p_code text,
  p_service text,
  p_amount integer,
  p_lock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  coupon public.coupons%rowtype;
  norm text;
  service_key text;
  discount integer;
  charge integer;
  uses integer;
begin
  norm := upper(translate(trim(coalesce(p_code, '')), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  norm := regexp_replace(norm, '[^A-Z0-9-]', '', 'g');
  if norm !~ '^[A-Z0-9-]{3,24}$' then
    return jsonb_build_object('ok', false, 'error', 'Ese cupón no está disponible.');
  end if;
  if p_lock then
    select * into coupon from public.coupons where code = norm for update;
  else
    select * into coupon from public.coupons where code = norm;
  end if;
  if not found or coupon.active is not true then
    return jsonb_build_object('ok', false, 'error', 'Ese cupón no está disponible.');
  end if;
  if coupon.expires_on is not null and coupon.expires_on < (timezone('America/Santiago', now()))::date then
    return jsonb_build_object('ok', false, 'error', 'Ese cupón venció.');
  end if;

  service_key := lower(translate(coalesce(p_service, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN'));
  if coupon.applies_to = 'control' and position('control' in service_key) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Este cupón solo aplica al siguiente control.');
  end if;
  if coalesce(p_amount, 0) < 1000 then
    return jsonb_build_object('ok', false, 'error', 'El monto es demasiado bajo para un cupón.');
  end if;

  if coupon.max_uses is not null then
    select count(*) into uses
    from public.coupon_redemptions r
    where r.coupon_id = coupon.id
      and (
        r.status = 'usado'
        or (r.status = 'reservado' and r.created_at > now() - interval '30 minutes')
      );
    if uses >= coupon.max_uses then
      return jsonb_build_object('ok', false, 'error', 'Ese cupón ya se usó.');
    end if;
  end if;

  if coupon.percent is not null then
    discount := round(p_amount * coupon.percent / 100.0)::integer;
  else
    discount := coupon.amount_off;
  end if;
  if discount is null or discount < 1 then
    return jsonb_build_object('ok', false, 'error', 'Este cupón no tiene un descuento.');
  end if;
  if p_amount - discount < 1000 then
    discount := p_amount - 1000;
  end if;
  if discount < 1 then
    return jsonb_build_object('ok', false, 'error', 'El monto es demasiado bajo para un cupón.');
  end if;
  charge := p_amount - discount;

  return jsonb_build_object(
    'ok', true,
    'coupon_id', coupon.id,
    'code', coupon.code,
    'label', coupon.label,
    'percent', coupon.percent,
    'amount_off', coupon.amount_off,
    'discount', discount,
    'amount', charge,
    'amount_before', p_amount
  );
end;
$$;

create or replace function public.quote_coupon(p_code text, p_service text, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.coupon_compute(p_code, p_service, p_amount, false);
end;
$$;

create or replace function public.reserve_coupon(
  p_code text,
  p_service text,
  p_amount integer,
  p_payment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  quote jsonb;
begin
  if p_payment_id is null then
    return jsonb_build_object('ok', false, 'error', 'No se pudo reservar el cupón.');
  end if;
  quote := public.coupon_compute(p_code, p_service, p_amount, true);
  if coalesce((quote->>'ok')::boolean, false) is not true then
    return quote;
  end if;
  insert into public.coupon_redemptions (coupon_id, payment_id, status, amount_before, discount, amount_after)
  values (
    (quote->>'coupon_id')::uuid,
    p_payment_id,
    'reservado',
    (quote->>'amount_before')::integer,
    (quote->>'discount')::integer,
    (quote->>'amount')::integer
  )
  on conflict (payment_id) do update
    set coupon_id = excluded.coupon_id,
        status = 'reservado',
        amount_before = excluded.amount_before,
        discount = excluded.discount,
        amount_after = excluded.amount_after,
        created_at = now();
  return quote;
end;
$$;

revoke all on function public.coupon_compute(text, text, integer, boolean) from public;
revoke all on function public.reserve_coupon(text, text, integer, uuid) from public;
revoke all on function public.quote_coupon(text, text, integer) from public;
grant execute on function public.coupon_compute(text, text, integer, boolean) to postgres, service_role;
grant execute on function public.reserve_coupon(text, text, integer, uuid) to postgres, service_role;
grant execute on function public.quote_coupon(text, text, integer) to anon, authenticated, service_role;

insert into public.coupons (code, label, percent, applies_to, pitch, active)
values (
  'RESENA',
  'Reseña en Google',
  5,
  'control',
  'Si dejas una reseña positiva en Google, tienes 5% de descuento en el siguiente control. Al pagar, escribe el código RESENA.',
  true
)
on conflict (code) do nothing;
