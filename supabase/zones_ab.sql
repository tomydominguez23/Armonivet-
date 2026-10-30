-- =============================================================================
-- Armonivet · Renombra zonas públicas: A+B → Sector A, C → Sector B
-- SQL Editor de Supabase. Idempotente.
-- =============================================================================

-- Une comunas de A y B en Sector A
update public.pricing_zones a
set
  name = 'Sector A',
  badge = 'Sector A',
  price = 65000,
  zones_text = 'Ñuñoa, Macul, Providencia, Santiago Centro (hasta Santa Lucía), San Joaquín, Vitacura (límite), Las Condes (hasta Padre Hurtado), La Reina (hasta Valenzuela Llano), Peñalolén (hasta Consistorial), San Miguel y La Florida.',
  map_embed_url = coalesce(
    a.map_embed_url,
    'https://maps.google.com/maps?q=Providencia,+Santiago,+Chile&hl=es&z=12&output=embed'
  ),
  featured = true,
  sort_order = 1,
  active = true
where a.name in ('Sector A', 'Sector A y B');

-- Si existía Sector B al mismo precio, lo desactivamos (quedó fusionado en A)
update public.pricing_zones
set active = false,
    sort_order = 99
where name = 'Sector B'
  and coalesce(price, 0) <= 65000
  and exists (
    select 1 from public.pricing_zones z
    where z.name = 'Sector A' and z.active is distinct from false
  );

-- Antiguo Sector C pasa a llamarse Sector B
update public.pricing_zones
set
  name = 'Sector B',
  badge = 'Sector B',
  price = 70000,
  sort_order = 2,
  active = true
where name = 'Sector C';

-- Si ya había un Sector B desactivado y no quedó C renombrado, reactiva uno a 70.000
insert into public.pricing_zones (name, badge, price, zones_text, map_embed_url, featured, sort_order, active)
select
  'Sector B',
  'Sector B',
  70000,
  'Santiago Centro (U. de Chile a Los Héroes), Lo Barnechea, La Dehesa, San Carlos de Apoquindo, oriente de Las Condes / La Reina / Vitacura / Peñalolén, San Bernardo, Puente Alto y Huechuraba.',
  'https://maps.google.com/maps?q=Las+Condes,+Santiago,+Chile&hl=es&z=12&output=embed',
  false,
  2,
  true
where not exists (
  select 1 from public.pricing_zones z
  where z.name = 'Sector B' and z.active is distinct from false and coalesce(z.price, 0) >= 70000
);

update public.services
set description = replace(replace(coalesce(description, ''), 'Sector A y B', 'Sector A'), 'Sector C', 'Sector B')
where description ilike '%Sector A y B%'
   or description ilike '%Sector C%';
