-- =============================================================================
-- Armonivet · Datos iniciales (seed)
-- Ejecutar DESPUÉS de schema.sql
-- =============================================================================

-- Canales de publicidad tipicos
insert into public.ad_channels (name, slug, utm_source, utm_medium, utm_campaign, color) values
  ('Instagram Orgánico', 'instagram', 'instagram', 'social', 'organico', '#E1306C'),
  ('Instagram Ads', 'instagram-ads', 'instagram', 'paid', 'ads', '#C13584'),
  ('Google Ads', 'google-ads', 'google', 'cpc', 'search', '#4285F4'),
  ('Facebook Ads', 'facebook-ads', 'facebook', 'paid', 'ads', '#1877F2'),
  ('WhatsApp', 'whatsapp', 'whatsapp', 'referral', 'directo', '#25D366'),
  ('Boca a boca', 'referido', 'referido', 'referral', 'boca-a-boca', '#2f6f84'),
  ('Directo / Orgánico', 'directo', null, null, null, '#6b7380'),
  ('Tu Día / Medios', 'medios', 'medios', 'pr', 'tu-dia', '#1f8a6e')
on conflict (slug) do nothing;

-- Servicios
insert into public.services (slug, title, description, price_from, price_label, image_url, tag, sort_order, section) values
  (
    'etologia-clinica',
    'Consulta Etología Clínica',
    'Evaluación + plan + seguimiento 30 días',
    40000,
    'Desde $40.000',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80',
    'Más pedido',
    1,
    'ambos'
  ),
  (
    'asesoria-felina-canina',
    'Asesoría felina / canina',
    'Miedo, ruidos, mudanzas y convivencia',
    40000,
    'Desde $40.000',
    'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=900&q=80',
    'Gatos',
    2,
    'ambos'
  ),
  (
    'consulta-online',
    'Consulta Online Preferente',
    'Ideal para agresividad, miedo y ansiedad',
    20000,
    'Abono $20.000',
    'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=900&q=80',
    'Online',
    3,
    'ambos'
  ),
  (
    'entrenamiento-basico',
    'Entrenamiento canino básico',
    'Educación guiada para el día a día',
    null,
    'Consulta incluible',
    'https://images.unsplash.com/photo-1601758228041-f3b2795255f1?auto=format&fit=crop&w=900&q=80',
    'Entrenamiento',
    4,
    'ambos'
  ),
  (
    'flores-de-bach',
    'Terapia con Flores de Bach',
    'Complemento natural; primer frasco incluido si corresponde.',
    null,
    null,
    'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=800&q=80',
    null,
    5,
    'servicios'
  )
on conflict (slug) do nothing;

-- Zonas de precio (idempotente)
delete from public.pricing_zones;
insert into public.pricing_zones (name, badge, price, zones_text, image_url, map_embed_url, featured, sort_order) values
  (
    'Sector A',
    'Sector A',
    40000,
    'Ñuñoa y Macul',
    'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=900&q=80',
    'https://maps.google.com/maps?q=Ñuñoa,+Santiago,+Chile&hl=es&z=13&output=embed',
    false,
    1
  ),
  (
    'Sector B',
    'Sector B · Popular',
    45000,
    'Providencia, Santiago Centro (hasta Santa Lucía), San Joaquín, Vitacura (límite), Las Condes (hasta Padre Hurtado), La Reina (hasta Valenzuela Llano), Peñalolén (hasta Consistorial), San Miguel y La Florida.',
    'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=900&q=80',
    'https://maps.google.com/maps?q=Providencia,+Santiago,+Chile&hl=es&z=13&output=embed',
    true,
    2
  ),
  (
    'Sector C',
    'Sector C',
    50000,
    'Santiago Centro (U. de Chile a Los Héroes), Lo Barnechea, La Dehesa, San Carlos de Apoquindo, oriente de Las Condes / La Reina / Vitacura / Peñalolén, San Bernardo, Puente Alto y Huechuraba.',
    'https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=900&q=80',
    'https://maps.google.com/maps?q=Las+Condes,+Santiago,+Chile&hl=es&z=12&output=embed',
    false,
    3
  );

-- Extras de precio
delete from public.price_extras;
insert into public.price_extras (label, amount, sort_order) values
  ('Las Vizcachas', 5000, 1),
  ('Domingos y festivos', 10000, 2),
  ('Abono para confirmar (12 horas)', 20000, 3);

-- Slots de imágenes editables
insert into public.site_media (slot, title, url, alt_text) values
  ('hero_1', 'Hero slide 1', 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=2000&q=80', 'Consulta profesional'),
  ('hero_2', 'Hero slide 2', 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=2000&q=80', 'Perros y gatos'),
  ('hero_3', 'Hero slide 3', 'https://images.unsplash.com/photo-1587300003388-59208cc962cb?auto=format&fit=crop&w=2000&q=80', 'Consulta online'),
  ('gallery_1', 'Galería 1', 'https://images.unsplash.com/photo-1558788353-f76d92427f16?auto=format&fit=crop&w=800&q=80', 'Perro feliz en casa'),
  ('gallery_2', 'Galería 2', 'https://images.unsplash.com/photo-1574158622682-e40e69881006?auto=format&fit=crop&w=800&q=80', 'Gato en reposo'),
  ('gallery_3', 'Galería 3', 'https://images.unsplash.com/photo-1530281700549-e82e7bf110d6?auto=format&fit=crop&w=800&q=80', 'Perro corriendo'),
  ('gallery_4', 'Galería 4', 'https://images.unsplash.com/photo-1596854407944-bf87f6fdd49e?auto=format&fit=crop&w=800&q=80', 'Gato atento'),
  ('gallery_5', 'Galería 5', 'https://images.unsplash.com/photo-1583511655857-d19b40a7a54e?auto=format&fit=crop&w=800&q=80', 'Cachorro con tutor'),
  ('gallery_6', 'Galería 6', 'https://images.unsplash.com/photo-1516734212186-a967f81ad0d7?auto=format&fit=crop&w=800&q=80', 'Paseo con perro'),
  ('about_doctor', 'Foto Dra. Bárbara', './dra-barbara.jpg', 'Dra. Bárbara Castillo'),
  ('mid_banner', 'Banner medio', 'https://images.unsplash.com/photo-1450778869180-41d0601e046e?auto=format&fit=crop&w=1200&q=80', 'Perro y gato juntos')
on conflict (slot) do nothing;

-- Ajustes del negocio
insert into public.site_settings (key, value) values
  ('business', '{
    "name": "Armonivet",
    "tagline": "Etología clínica · Entrenamiento · Flores de Bach · Santiago",
    "calendly_url": "https://calendly.com/armonivet/consulta-etologia-clinica",
    "form_url": "https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform",
    "instagram_url": "https://www.instagram.com/armonivet/",
    "promo_text": "Desde $40.000 · Consulta + seguimiento 30 días · Flores de Bach si corresponde",
    "deposit_amount": 20000,
    "min_price": 40000
  }'::jsonb)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- Crear usuario admin (ejecutar DESPUÉS de crear el usuario en Authentication)
-- Opción A (recomendada): Dashboard → Authentication → Users → Add user
--   email: admin@armonivet.cl  (o el tuyo) + password
-- El trigger handle_new_user creará el perfil automáticamente.
--
-- Opción B: si ya tienes el UUID del usuario:
--   update public.profiles set role = 'admin' where email = 'tu@email.com';
-- -----------------------------------------------------------------------------
