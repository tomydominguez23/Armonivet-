# Supabase · Armonivet

Ejecuta estos SQL en el **SQL Editor** de tu proyecto Supabase, en este orden:

1. `schema.sql` — tablas, RLS, bucket `site-images`
2. `seed.sql` — datos iniciales (servicios, precios, canales, media)
3. `rpc_stats.sql` — métricas del dashboard (`admin_dashboard_stats`)
4. `fix_tracking_rpc.sql` — tracking de visitas + bucket (recomendado)

## Usuario admin

1. Dashboard → **Authentication** → **Users** → **Add user**
2. Email + password (el trigger crea el perfil en `profiles` con rol `admin`)
3. En el sitio, footer → **Iniciar sesión** → `/admin/`

## Variables de entorno

Copia `.env.example` a `.env` con:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

En GitHub Actions, agrega los mismos valores como **Secrets** del repo.
