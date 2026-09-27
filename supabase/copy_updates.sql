-- Textos de la web (idempotente). Preferí prices_services.sql para precios y servicios nuevos.
update public.services
set description = 'Evaluación diagnóstica, guía de trabajo y plan de modificación conductual por 30 días.'
where slug = 'etologia-clinica';
