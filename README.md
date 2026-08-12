# Armonivet

Landing page de **Armonivet**: etología clínica, entrenamiento canino y terapia con Flores de Bach en Santiago.

Incluye un **panel de administración** con métricas, citas, canales de publicidad, servicios, precios e imágenes, respaldado por **Supabase**.

## Desarrollo

```bash
npm install
cp .env.example .env
# Completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm run dev
```

- Sitio público: `http://localhost:5173/`
- Admin: `http://localhost:5173/admin/` (enlace también en el footer → **Iniciar sesión**)

## Producción

```bash
npm run build
npm run preview
```

La carpeta `dist/` queda lista para desplegar en cualquier hosting estático (Netlify, Vercel, GitHub Pages, etc.).

## Configurar Supabase (obligatorio para el panel)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta en este orden:
   - `supabase/schema.sql` — tablas, RLS, storage
   - `supabase/seed.sql` — servicios, precios, canales e imágenes iniciales
   - `supabase/rpc_stats.sql` — función de métricas del dashboard
3. En **Authentication → Users → Add user**, crea el admin (email + password).
4. Copia **Project URL** y **anon public key** a tu `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Reinicia `npm run dev` e inicia sesión desde el footer o `/admin/`.

### Tracking de publicidad

Comparte URLs con UTM o `ref`:

- `https://tu-dominio/?utm_source=instagram&utm_medium=social`
- `https://tu-dominio/?ref=google-ads`

El panel muestra visitas, clics a agendar, citas, abonos y llegadas por canal.

### Qué puedes gestionar en el admin

| Sección | Función |
|---|---|
| Dashboard | Visitas, embudo, canales, ingresos estimados |
| Citas | Agendadas / abonadas / llegaron / completadas |
| Canales | Fuentes de publicidad (UTM) |
| Servicios | Títulos, precios, imágenes, Calendly |
| Precios | Zonas A/B/C y extras |
| Imágenes | Hero, galería, doctora, banners (Storage) |
| Ajustes | Enlaces y textos del negocio |

## Enlaces integrados

- Agenda: [Calendly](https://calendly.com/armonivet/consulta-etologia-clinica)
- Formulario previo: [Google Forms](https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform)
- Instagram: [@armonivet](https://www.instagram.com/armonivet/)
