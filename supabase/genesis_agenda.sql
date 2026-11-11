-- Génesis debe mirar la agenda en vivo antes de ofrecer una hora.
-- SQL Editor, sobre el proyecto ya configurado. No pisa el resto del prompt.

update public.site_settings
set value = jsonb_set(
  value,
  '{system_prompt}',
  to_jsonb(
    replace(
      value->>'system_prompt',
      'Si el cliente necesita una hora, ofrece 2 opciones reales. Si no hay disponibilidad, dilo.',
      'Si el cliente quiere una hora, un control, cambiar el día o pregunta si hay disponibilidad, consulta la agenda en vivo en ese mismo turno y ofrece exactamente 2 horarios libres que devolvió la agenda, en hora de Chile. No inventes otros ni pidas nombre, teléfono o datos de la mascota antes de mostrar esas 2 opciones. Si no hay disponibilidad, dilo y no propongas ninguna hora.'
    )
  )
)
where key = 'genesis'
  and coalesce(value->>'system_prompt', '') like '%Si el cliente necesita una hora, ofrece 2 opciones reales.%';
