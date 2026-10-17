-- =============================================================================
-- Armonivet · Precios 2026 (consulta, control y packs)
-- SQL Editor, sobre el proyecto que ya tiene seed + booking
-- =============================================================================

-- Zonas: primera consulta presencial
update public.pricing_zones set price = 65000 where name = 'Sector A';
update public.pricing_zones set price = 65000 where name = 'Sector B';
update public.pricing_zones set price = 70000 where name = 'Sector C';

-- Extras: sin Vizcachas ni abono
delete from public.price_extras;
insert into public.price_extras (label, amount, sort_order) values
  ('Domingos y festivos', 10000, 1);

-- Servicios existentes
update public.services
set
  description = 'Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.',
  price_from = 65000,
  price_label = 'Desde $65.000',
  tag = null,
  sort_order = 2
where slug = 'etologia-clinica';

update public.services
set
  title = 'Consulta Online Preferente',
  description = 'Ideal para agresividad, miedo y ansiedad. Mismo plan de 30 días, desde cualquier comuna.',
  price_from = 50000,
  price_label = '$50.000',
  tag = 'Más vendido',
  sort_order = 1
where slug = 'consulta-online';

update public.services
set
  title = 'Entrenamiento canino profesional',
  description = 'Educación guiada para el día a día y el vínculo familiar.',
  price_from = 45000,
  price_label = 'Desde $45.000',
  tag = 'Entrenamiento',
  sort_order = 4
where slug = 'entrenamiento-basico';

update public.services
set
  description = 'Miedo, ruidos, mudanzas y convivencia',
  price_from = 45000,
  price_label = 'Desde $45.000',
  sort_order = 6
where slug = 'asesoria-felina-canina';

insert into public.services (slug, title, description, price_from, price_label, image_url, tag, sort_order, section) values
  (
    'entrenamiento-temprano',
    'Entrenamiento temprano',
    '¿Tu cachorro se orina y se defeca en todas partes? ¿Muerde todo lo que pilla en casa, incluido a ustedes? Educación temprana de 3 a 6 meses, con la Dra. Bárbara.',
    45000,
    'Desde $45.000',
    'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=900&q=80',
    'Cachorros',
    3,
    'ambos'
  ),
  (
    'cat-pet-sitter',
    'Cat y pet sitter / paseos educativos',
    'Cuidado y paseos educativos sujetos a disponibilidad.',
    null,
    'Sujeto a disponibilidad',
    'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=900&q=80',
    'Disponibilidad',
    5,
    'ambos'
  ),
  (
    'control-online',
    'Control online',
    'Seguimiento por videollamada después de la primera consulta.',
    38000,
    '$38.000',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80',
    'Control',
    8,
    'servicios'
  ),
  (
    'control-presencial',
    'Control presencial',
    'Control a domicilio. Sector A y B $50.000 · Sector C $55.000.',
    50000,
    'Desde $50.000',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80',
    'Control',
    9,
    'servicios'
  ),
  (
    'pack-inicio-online',
    'Pack Inicio online',
    '1 primera consulta online + 1 control online.',
    84000,
    '$84.000',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80',
    'Pack',
    10,
    'servicios'
  ),
  (
    'pack-continuidad-online',
    'Pack Continuidad online',
    '1 primera consulta online + 2 controles online.',
    120000,
    '$120.000',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80',
    'Pack',
    11,
    'servicios'
  ),
  (
    'pack-mixto',
    'Pack Acompañamiento mixto',
    '1 primera consulta presencial + 1 control online.',
    98000,
    '$98.000',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80',
    'Pack',
    12,
    'servicios'
  ),
  (
    'pack-seguimiento-presencial',
    'Pack Seguimiento presencial',
    '1 primera consulta presencial + 2 controles presenciales.',
    155000,
    '$155.000',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80',
    'Pack',
    13,
    'servicios'
  )
on conflict (slug) do update
set
  title = excluded.title,
  description = excluded.description,
  price_from = excluded.price_from,
  price_label = excluded.price_label,
  tag = excluded.tag,
  sort_order = excluded.sort_order,
  section = excluded.section,
  image_url = coalesce(public.services.image_url, excluded.image_url);

-- Ajustes del negocio (jsonb_build_object evita 42804: unknown en jsonb_set/to_jsonb)
update public.site_settings
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
  'promo_text', 'Desde $50.000 · Primera consulta online · Flores de Bach si corresponde',
  'min_price', 38000,
  'deposit_amount', 0
)
where key = 'business';

update public.site_settings
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
  'min_price', 38000,
  'deposit_amount', 0,
  'system_prompt', $genesis$Eres Génesis, secretaria de Armonivet (etología clínica, entrenamiento y Flores de Bach). Hablas en español de Chile, cálida, clara y breve. No das diagnósticos veterinarios ni recetas. Tu trabajo es calificar leads y agendar. La hora se confirma pagando el valor total (como un psicólogo), no hay abono de $20.000. Servicios: consulta presencial, consulta remota, entrenamiento canino profesional, entrenamiento temprano (cachorros), control presencial, control remoto, packs, 2 pacientes mismo hogar, cat y pet sitter / paseos educativos (sujetos a disponibilidad). Precios: primera consulta online $50.000; control online $38.000; primera consulta presencial Sector A y B $65.000, Sector C $70.000; control presencial Sector A y B $50.000, Sector C $55.000. Packs: Inicio online $84.000 (1 primera + 1 control online); Continuidad online $120.000 (1 primera + 2 controles online); Acompañamiento mixto $98.000 (1 primera presencial + 1 control online); Seguimiento presencial $155.000 (1 primera presencial + 2 controles presenciales). Entrenamiento desde $45.000. Domingos y festivos +$10.000. No ofrezcas “seguir el plan después de 30 días” como plan anual: si piden control, agenda un control. Nunca inventes precios, horarios ni pagos: usa las herramientas. Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo. Si pide consejo clínico profundo, agenda consulta.$genesis$
)
where key = 'genesis';
