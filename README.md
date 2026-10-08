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

La carpeta `dist/` queda lista para desplegar en cualquier hosting estático.

### GitHub Pages

Cada push a `main` publica en `https://tomydominguez23.github.io/Armonivet-/` (workflow **Deploy GitHub Pages**).

### Tu servidor (actualización automática)

Cuando hay un cambio en `main`, GitHub Actions **construye el sitio y lo sube a tu servidor**.

En el repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Qué es |
|---|---|
| `DEPLOY_HOST` | IP o dominio del servidor (`armonivet.cl` o `123.45.67.89`) |
| `DEPLOY_USER` | Usuario SSH o FTP |
| `DEPLOY_PATH` | Carpeta pública, ej. `/home/USUARIO/public_html/` |
| `DEPLOY_SSH_KEY` | Clave **privada** SSH (si el hosting tiene SSH) |
| `DEPLOY_PORT` | Opcional. Puerto SSH, por defecto `22` |
| `DEPLOY_PASSWORD` | Solo si no hay SSH: contraseña FTP |

También tienen que existir `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ya las usa Pages).

**Si el servidor tiene SSH** (VPS o cPanel con SSH):

1. En tu PC: `ssh-keygen -t ed25519 -C "github-armonivet" -f armonivet-deploy -N ""`
2. En el servidor, agregá el contenido de `armonivet-deploy.pub` a `~/.ssh/authorized_keys`
3. En GitHub, el contenido de `armonivet-deploy` (la clave **privada**) va en `DEPLOY_SSH_KEY`
4. `DEPLOY_PATH` debe ser la carpeta del sitio, no todo el servidor

**Si solo hay FTP** (Hostinger, hosting compartido sin SSH): no cargues `DEPLOY_SSH_KEY`. Usá `DEPLOY_PASSWORD` y en `DEPLOY_PATH` algo como `/public_html/`.

Después de guardar los secretos, **Actions → Deploy servidor → Run workflow**. Cada commit siguiente a `main` actualiza la web solo.

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
| Servicios | Títulos, precios, imágenes |
| Precios | Zonas A/B/C y extras |
| Imágenes | Hero, galería, doctora, banners (Storage) |
| Ajustes | Enlaces y textos del negocio |

## Enlaces integrados

- Agenda: calendario propio en `#agendar` (Supabase: `booking.sql`)
- Quiénes somos: `about.html`
- Formulario previo: [Google Forms](https://docs.google.com/forms/d/e/1FAIpQLSc4AlHaQq3HRlGzBbTLffJDYGjSMW3_UpL2BD2-gdSRW_q6uQ/viewform)
- Instagram: [@armonivet](https://www.instagram.com/armonivet/)
