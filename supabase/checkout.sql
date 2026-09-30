-- =============================================================================
-- Armonivet · Pagos en la plataforma (carrito + Mercado Pago)
-- SQL Editor, después de genesis.sql + booking.sql
-- =============================================================================

alter table public.payments
  add column if not exists items jsonb not null default '[]'::jsonb;

alter table public.payments
  add column if not exists provider_ref text;

alter table public.payments
  add column if not exists currency text not null default 'CLP';

create index if not exists payments_provider_ref_idx on public.payments (provider_ref);

grant select on public.payments to authenticated;
