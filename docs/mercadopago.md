# Vincular Mercado Pago (Checkout API)

El cobro se hace **en el sitio** (Payment Brick): tarjeta o cuenta Mercado Pago, sin mandar datos de tarjeta a nuestro servidor. El Access Token vive solo en Supabase Edge Functions.

## 1. Crear la aplicación

1. Entrá a [Tus integraciones](https://www.mercadopago.cl/developers/panel/app) con la cuenta de Armonivet.
2. **Crear aplicación**.
3. Nombre: `Armonivet web`.
4. Producto: **Checkout API** (el que te indicó Mercado Pago).
5. Industria: servicios / veterinaria, o la más cercana.

## 2. Copiar las credenciales

En la app, menú izquierdo:

- **Pruebas → Credenciales de prueba** para probar.
- **Producción → Credenciales de producción** para cobrar de verdad (hay que activarlas: industria, URL del sitio `https://armonivet.com`, aceptar términos).

Copiá:

| Dato | Dónde va |
|---|---|
| **Public Key** (`APP_USR-…` o `TEST-…`) | Secret `MERCADOPAGO_PUBLIC_KEY` |
| **Access Token** | Secret `MERCADOPAGO_ACCESS_TOKEN` |

Nunca pongas el Access Token en GitHub, `.env` de Vite ni el panel admin.

## 3. Pegarlas en Supabase

Supabase → proyecto Armonivet → **Project Settings → Edge Functions → Secrets**:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_PUBLIC_KEY`
- `PUBLIC_SITE_URL` = `https://armonivet.com`

## 4. SQL (una vez)

En **SQL Editor**, si no lo corriste: `supabase/checkout.sql`.

## 5. Publicar las funciones

GitHub → **Actions → Deploy Edge Functions → Run workflow** (o un push a `main` que toque `supabase/functions`).

Quedan tres funciones:

- `create-checkout` — arma el pago y la preferencia
- `process-payment` — cobra la tarjeta tokenizada por el Brick
- `mercadopago-webhook` — confirma el estado cuando Mercado Pago avisa

## 6. Probar

1. Abrí `https://armonivet.com`, agregá un servicio, reservá hora, **Pagar ahora**.
2. Tiene que abrirse el formulario de Mercado Pago **en la misma página**.
3. Con credenciales de prueba usá las [tarjetas de prueba](https://www.mercadopago.cl/developers/es/docs/checkout-api-payments/additional-content/test-cards).
4. Si el pago está aprobado, la hora pasa a confirmada.

Cuando funcione en prueba, cambiá los secrets por las credenciales de **producción** y volvé a pagar un monto real chico.
