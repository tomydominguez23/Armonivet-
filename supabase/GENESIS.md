# Génesis · WhatsApp + dashboard Armonivet

Génesis **no** se conecta directo a WhatsApp ni al JavaScript público de GitHub Pages.

```
WhatsApp  →  Wazend  →  whatsapp-webhook  →  Génesis  →  Wazend sendText  →  WhatsApp
```

Guía de Wazend: [`docs/wazend.md`](../docs/wazend.md). Cloud API de Meta sigue como respaldo si no hay `WAZEND_API_KEY`.

## 1. SQL

En el SQL Editor de Supabase, en este orden:

1. `schema.sql` (si el proyecto es nuevo)
2. `schema_v2.sql`
3. `genesis.sql`  ← este archivo crea chats, pagos, recordatorios y auditoría
4. `booking.sql`  ← agenda propia: Génesis y la web leen las mismas horas (`list_available_slots`)
5. `checkout.sql`  ← carrito y Mercado Pago

## 2. Secretos (solo en Edge Functions)

Dashboard de Supabase → **Project Settings → Edge Functions → Secrets**:

| Secret | Qué es |
|---|---|
| `OPENAI_API_KEY` | Clave de OpenAI |
| `WAZEND_BASE_URL` | URL del servidor Wazend (panel) |
| `WAZEND_API_KEY` | API Key de Wazend |
| `WAZEND_SESSION` | Nombre de la sesión (ej. `S0001`) |
| `WAZEND_WEBHOOK_HMAC` | Opcional, firma del webhook |
| `WHATSAPP_TOKEN` | (Respaldo Meta) Token permanente de Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | (Respaldo Meta) ID del número |
| `WHATSAPP_VERIFY_TOKEN` | (Respaldo Meta) Verify token |
| `WHATSAPP_APP_SECRET` | (Respaldo Meta) App Secret |
| `GENESIS_CRON_SECRET` | Opcional, para el cron de recordatorios |
| `MERCADOPAGO_ACCESS_TOKEN` | Access Token de Mercado Pago (Checkout API). Solo en el servidor. |
| `MERCADOPAGO_PUBLIC_KEY` | Public Key de la misma aplicación. El frontend la pide al servidor; no va en Vite. |
| `PUBLIC_SITE_URL` | URL pública, ej. `https://armonivet.com` |

**No** pongas estas claves en `.env` de Vite ni en GitHub Actions. Esa capa es pública.

Guía de Mercado Pago (Checkout API): [`docs/mercadopago.md`](../docs/mercadopago.md).

## 3. Desplegar funciones (sin instalar nada)

1. Token: [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token** → copiálo.
2. En GitHub → este repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `SUPABASE_ACCESS_TOKEN`
   - Secret: el token
3. **Actions → Deploy Edge Functions → Run workflow**.

Eso publica `whatsapp-webhook`, `genesis-cron`, `whatsapp-send` y `genesis-simulate`. El secret `OPENAI_API_KEY` ya tiene que estar en Supabase (Project Settings → Edge Functions → Secrets). No lo pongas en GitHub.

Alternativa con CLI local:

```bash
supabase login
supabase link --project-ref xcnxqhjthrdvjtqezzct
supabase functions deploy
```

Callback URL (Wazend y Meta):

```
https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/whatsapp-webhook
```

## 4. Wazend (recomendado) o Meta Cloud API

**Wazend:** pasos en [`docs/wazend.md`](../docs/wazend.md). Pegá la URL de arriba como webhook de la sesión, evento `message`.

**Meta (respaldo):** [developers.facebook.com](https://developers.facebook.com/) → WhatsApp → Webhook → la misma URL y `WHATSAPP_VERIFY_TOKEN`. Subscribe **messages**.

Con Wazend no hace falta plantilla HSM de Meta para responder en la ventana de 24 h: Génesis contesta texto libre por `sendText`.

## 5. Probar sin WhatsApp

1. Entrá al admin → **WhatsApp**
2. **Simular mensaje**
3. Génesis (si hay `OPENAI_API_KEY` **y créditos** en OpenAI) responde y el chat aparece en la bandeja.

Si no hay respuesta, el hilo muestra una nota **Sistema** con el error. Para hablar vos, escribí en el recuadro de abajo (no hace falta que “Tomar conversación” habilite nada: al enviar se pausa Génesis).

Si dice que no hay créditos: [Billing de OpenAI](https://platform.openai.com/settings/organization/billing). No hace falta redesplegar funciones.

## 6. Cron de recordatorios (abono 12 h, 24 h antes, etc.)

Invocar cada 15 minutos:

```
GET/POST https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/genesis-cron?secret=GENESIS_CRON_SECRET
```

Podés usar un cron de GitHub Actions, pg_cron + pg_net, o el scheduler de Supabase.

## Qué hace Génesis hoy

- Crea lead + cliente al primer mensaje
- Consulta horas libres reales (`list_available_slots`, misma agenda que la web)
- Califica, agenda, reagenda, cancela
- Crea abono de $20.000 con vencimiento a 12 h
- Escala a humano (el dashboard puede **Tomar conversación** o escribir directo; al enviar se pausa Génesis)
- Si no puede responder, deja una nota **Sistema** en el hilo (créditos OpenAI, secretos de Wazend, Génesis apagada)
- Deja rastro en `genesis_actions`

Pagos reales (Flow / Mercado Pago / Webpay) y plantillas HSM son el siguiente paso, cuando tengas el link o la pasarela.
