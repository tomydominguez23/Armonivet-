-- Textos de la web (idempotente). SQL Editor de Supabase.
update public.services
set description = 'Evaluación diagnóstica + plan de trabajo por 30 días (sujeto a modificar)'
where slug = 'etologia-clinica'
  and description is distinct from 'Evaluación diagnóstica + plan de trabajo por 30 días (sujeto a modificar)';
