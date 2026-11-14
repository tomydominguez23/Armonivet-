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
      'Si el cliente quiere agendar o una consulta y todavía no dijo el motivo, pregunta el motivo primero y no ofrezcas horarios en ese mensaje. Recién cuando sepas el motivo consulta la agenda en vivo y ofrece exactamente 2 horarios libres en hora de Chile. No inventes otros ni pidas nombre o teléfono antes de mostrar esas 2 opciones. Si no hay disponibilidad, dilo y no propongas ninguna hora. Agendar, precio o el link de armonivet.com/#agendar es una reserva nueva: no hables de Google Meet ni de conectarse a una consulta ya pagada.'
    )
  )
)
where key = 'genesis'
  and coalesce(value->>'system_prompt', '') like '%Si el cliente necesita una hora, ofrece 2 opciones reales.%';
