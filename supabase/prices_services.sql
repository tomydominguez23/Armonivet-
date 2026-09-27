-- =============================================================================
-- Armonivet · Precios, servicios y pago total (sin abono)
-- SQL Editor, sobre el proyecto que ya tiene seed + booking
-- =============================================================================

-- Zonas
update public.pricing_zones set price = 45000 where name = 'Sector A';
update public.pricing_zones set price = 50000 where name = 'Sector B';
update public.pricing_zones set price = 55000 where name = 'Sector C';

-- Extras: sin Vizcachas ni abono
delete from public.price_extras;
insert into public.price_extras (label, amount, sort_order) values
  ('Domingos y festivos', 10000, 1);

-- Servicios existentes
update public.services
set
  description = 'Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.',
  price_from = 45000,
  price_label = 'Desde $45.000',
  tag = null,
  sort_order = 2
where slug = 'etologia-clinica';

update public.services
set
  title = 'Consulta Online Preferente',
  description = 'Ideal para agresividad, miedo y ansiedad. Mismo plan de 30 días, desde cualquier comuna.',
  price_from = 45000,
  price_label = 'Desde $45.000',
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

-- Ajustes del negocio
update public.site_settings
set value = jsonb_set(
  jsonb_set(
    jsonb_set(value, '{promo_text}', '"Desde $45.000 · Consulta + plan de 30 días · Flores de Bach si corresponde"'),
    '{min_price}', '45000'
  ),
  '{deposit_amount}', '0'
)
where key = 'business';

update public.site_settings
set value = jsonb_set(
  jsonb_set(
    jsonb_set(
      value,
      '{min_price}',
      '45000'
    ),
    '{deposit_amount}',
    '0'
  ),
  '{system_prompt}',
  to_jsonb(
    'Eres Génesis, secretaria de Armonivet (etología clínica, entrenamiento y Flores de Bach). Hablas en español de Chile, cálida, clara y breve. No das diagnósticos veterinarios ni recetas. Tu trabajo es calificar leads y agendar. La hora se confirma pagando el valor total de la consulta (como un psicólogo), no hay abono de $20.000. Servicios: consulta presencial, consulta remota, entrenamiento canino profesional, entrenamiento temprano (cachorros), control presencial, control remoto, 2 pacientes mismo hogar, cat y pet sitter / paseos educativos (sujetos a disponibilidad). Precios presenciales: Sector A $45.000, B $50.000, C $55.000. Domingos y festivos +$10.000. No ofrezcas “seguir el plan después de 30 días” como plan anual: si piden control, agenda un control. Nunca inventes precios, horarios ni pagos: usa las herramientas. Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo. Si pide consejo clínico profundo, agenda consulta.'
  )
)
where key = 'genesis';
