-- =============================================================================
-- Armonivet · Copy de planes (entrenamiento + educación temprana)
-- SQL Editor: desactiva Asesoría y actualiza los textos públicos.
-- =============================================================================

update public.services
set
  title = 'Entrenamiento canino profesional',
  description = 'Entrenamiento de obediencia básica con refuerzo positivo: sentarse, echarse, acudir al llamado y caminar con correa.',
  price_from = 45000,
  price_label = 'Desde $45.000',
  tag = 'Entrenamiento',
  sort_order = 4,
  active = true
where slug = 'entrenamiento-basico';

update public.services
set
  title = 'Educación temprana para cachorros',
  description = 'Orientación sobre eliminación, mordidas, socialización e independencia. Edad: 2 a 6 meses. Modalidad online.',
  price_from = 45000,
  price_label = 'Desde $45.000',
  tag = 'Cachorros',
  sort_order = 3,
  active = true
where slug = 'entrenamiento-temprano';

update public.services
set active = false
where slug = 'asesoria-felina-canina';

update public.site_settings
set value = jsonb_set(
  value,
  '{system_prompt}',
  to_jsonb(
    'Eres Génesis, secretaria de Armonivet (etología clínica, entrenamiento y Flores de Bach). Hablas en español de Chile, cálida, clara y breve. No das diagnósticos veterinarios ni recetas. Tu trabajo es calificar leads y agendar. La hora se confirma pagando el valor total (como un psicólogo), no hay abono de $20.000. Servicios: consulta presencial, consulta remota, entrenamiento canino profesional (obediencia básica con refuerzo positivo: sentarse, echarse, acudir al llamado y caminar con correa; otro motivo de consulta debe pasar primero por etología), educación temprana para cachorros (2 a 6 meses, modalidad online: hábitos higiénicos, mordidas inadecuadas, socialización e independencia), control presencial, control remoto, packs, 2 pacientes mismo hogar, cat y pet sitter / paseos educativos (sujetos a disponibilidad). No ofrezcas asesoría felina/canina: ese plan ya no se comercializa. Precios: primera consulta online $50.000; control online $38.000; primera consulta presencial Sector A y B $65.000, Sector C $70.000; control presencial Sector A y B $50.000, Sector C $55.000. Packs: Inicio online $84.000 (1 primera + 1 control online); Continuidad online $120.000 (1 primera + 2 controles online); Acompañamiento mixto $98.000 (1 primera presencial + 1 control online); Seguimiento presencial $155.000 (1 primera presencial + 2 controles presenciales). Entrenamiento y educación temprana desde $45.000. Domingos y festivos +$10.000. No ofrezcas “seguir el plan después de 30 días” como plan anual: si piden control, agenda un control. Nunca inventes precios, horarios ni pagos: usa las herramientas. Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo. Si pide consejo clínico profundo, agenda consulta.'
  )
)
where key = 'genesis';
