# Paso a paso: vincular Mercado Pago

El cobro queda **en armonivet.com** (Checkout API / Payment Brick). El Access Token nunca va en GitHub ni en el admin.

Hacé los bloques **en este orden**.

---

## 0. Publicar el código de la pasarela

1. Abrí el PR: https://github.com/tomydominguez23/Armonivet-/pull/33
2. **Merge pull request** (cuando deje de ser draft, **Ready for review** y después merge).
3. Esperá a que GitHub Actions termine (Pages y, si aplica, Deploy servidor).

Sin este merge, el sitio viejo no tiene el formulario de pago.

---

## 1. Crear la app en Mercado Pago

1. Entrá a [Tus integraciones](https://www.mercadopago.cl/developers/panel/app) con la cuenta de cobro de Armonivet (no una cuenta personal de prueba, si ya tenés la de la clínica).
2. Arriba a la derecha: **Crear aplicación** / **Create application**.
3. Completá:
   - **Nombre:** `Armonivet web`
   - **Producto / solución:** **Checkout API** (el de la doc que te mandaron)
   - **¿Qué tipo de integración?** Web / pagos online
   - **Industria:** servicios, salud o la más cercana a veterinaria
4. Creá la aplicación y abrila.

---

## 2. Copiar las credenciales de **prueba**

Todavía no uses producción. Primero hay que ver que el formulario abre.

1. En el menú izquierdo: **Pruebas** → **Credenciales de prueba** / **Test credentials**.
2. Copiá y guardá en un bloc de notas (sin espacios ni comillas):

| Qué ves en Mercado Pago | Nombre exacto en Supabase |
|---|---|
| **Public Key** | `MERCADOPAGO_PUBLIC_KEY` |
| **Access Token** | `MERCADOPAGO_ACCESS_TOKEN` |

La Public Key suele empezar con `TEST-`. El Access Token también.  
**No** subas el Access Token a GitHub.

---

## 3. Pegarlas en Supabase

1. Entrá a [Supabase](https://supabase.com/dashboard/project/xcnxqhjthrdvjtqezzct).
2. **Project Settings** (engranaje) → **Edge Functions** → **Secrets**.
3. **Add new secret**, uno por uno:

| Name | Value |
|---|---|
| `MERCADOPAGO_PUBLIC_KEY` | la Public Key de prueba |
| `MERCADOPAGO_ACCESS_TOKEN` | el Access Token de prueba |
| `PUBLIC_SITE_URL` | `https://armonivet.com` |

Si `PUBLIC_SITE_URL` ya existe, actualizalo a `https://armonivet.com` (sin barra al final).

---

## 4. SQL (una sola vez)

1. En Supabase: **SQL Editor** → **New query**.
2. Abrí en GitHub el archivo [`supabase/checkout.sql`](https://github.com/tomydominguez23/Armonivet-/blob/cursor/mercadopago-pasarela-e52e/supabase/checkout.sql), copiá todo y pegalo.
3. **Run**. Si dice que las columnas ya existen, está bien: no pisa datos.

---

## 5. Publicar las Edge Functions

Hace falta el secret `SUPABASE_ACCESS_TOKEN` en GitHub (si ya desplegaste Génesis, ya está).

1. Repo **Armonivet-** → **Actions**.
2. A la izquierda: **Deploy Edge Functions**.
3. **Run workflow** → branch **`main`** (después del merge) → **Run workflow**.
4. El job tiene que quedar **verde**.

Eso publica `create-checkout`, `process-payment` y `mercadopago-webhook`.

---

## 6. Probar en la web

1. Abrí `https://armonivet.com` (Ctrl+F5).
2. **Agregar** un servicio al carrito.
3. Completá la agenda y **Reservar hora**.
4. **Pagar ahora**.
5. Tiene que abrirse un recuadro en la misma página (Mercado Pago), no un listado de carpetas ni un link genérico.

Tarjetas de prueba (Chile): [documentación oficial](https://www.mercadopago.cl/developers/es/docs/checkout-api-payments/additional-content/test-cards).

Si el pago sale **approved**, la hora queda confirmada sola.

---

## 7. Pasar a producción (cuando la prueba funcione)

1. En Tus integraciones → tu app → **Producción** → **Credenciales de producción**.
2. Activá: industria, sitio `https://armonivet.com`, términos.
3. Copiá Public Key y Access Token de **producción** (`APP_USR-…`).
4. En Supabase, **actualizá** los mismos dos secrets (no hace falta cambiar el nombre).
5. No hace falta redesplegar funciones: leen los secrets al vuelo.
6. Hacé un pago real chico y confirmá que entra en tu cuenta de Mercado Pago.

---

## Si algo falla

| Qué ves | Qué hacer |
|---|---|
| “El pago quedó pendiente” / no abre el Brick | Faltan los secrets o las funciones no se desplegaron. Revisá el paso 3 y 5. |
| Mercado Pago rechazó el cobro | Access Token mal copiado, o estás mezclando TEST con producción. |
| El recuadro abre pero la tarjeta falla | Seguí usando credenciales TEST y tarjetas de prueba. |
| Paga y la hora no se confirma | El webhook no está publicado. Volvé a correr **Deploy Edge Functions**. |
| Te manda a otro sitio de MP y vuelve | Está usando el respaldo (redirect). Falta `MERCADOPAGO_PUBLIC_KEY`. |
