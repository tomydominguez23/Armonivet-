# Génesis · WhatsApp + dashboard Armonivet

Génesis **no** se conecta directo a WhatsApp ni al JavaScript público de GitHub Pages.

```
WhatsApp Cloud API
        │  webhook
        ▼
Supabase Edge Function  ──▶  Postgres (única fuente de verdad)
        │                            │
        │ tools                      │ Realtime
        ▼                            ▼
   OpenAI GPT-5.6              Admin Armonivet
        │
        ▼
  WhatsApp (respuesta)
```

## 1. SQL

En el SQL Editor de Supabase, en este orden:

1. `schema.sql` (si el proyecto es nuevo)
2. `schema_v2.sql`
3. `genesis.sql`  ← este archivo crea chats, pagos, recordatorios y auditoría

## 2. Secretos (solo en Edge Functions)

Dashboard de Supabase → **Project Settings → Edge Functions → Secrets**:

| Secret | Qué es |
|---|---|
| `OPENAI_API_KEY` | Clave de OpenAI |
| `WHATSAPP_TOKEN` | Token permanente de Cloud API |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número |
| `WHATSAPP_VERIFY_TOKEN` | Una frase que inventás vos (ej. `armonivet-genesis-2026`) |
| `WHATSAPP_APP_SECRET` | App Secret de Meta (firma del webhook) |
| `GENESIS_CRON_SECRET` | Opcional, para el cron de recordatorios |

**No** pongas estas claves en `.env` de Vite ni en GitHub Actions. Esa capa es pública.

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

Callback URL para Meta:

```
https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/whatsapp-webhook
```

## 4. Meta / WhatsApp Cloud API

1. [developers.facebook.com](https://developers.facebook.com/) → app → producto **WhatsApp**.
2. WhatsApp → Configuration → Webhook:
   - Callback URL: la de arriba
   - Verify token: el mismo `WHATSAPP_VERIFY_TOKEN`
3. Subscribe al campo **messages**.
4. En números de prueba, agregá el celular de Bárbara como destinatario.
5. Cuando el negocio esté verificado, usá el número real de Armonivet.

Recordatorios fuera de las 24 h del cliente requieren **plantillas** aprobadas por Meta. Génesis responde en texto libre solo si la persona escribió hace menos de 24 horas.

## 5. Probar sin WhatsApp

1. Entrá al admin → **WhatsApp**
2. **Simular mensaje**
3. Génesis (si hay `OPENAI_API_KEY` **y créditos** en OpenAI) responde y el chat aparece en la bandeja.

Si dice que no hay créditos: [Billing de OpenAI](https://platform.openai.com/settings/organization/billing). No hace falta redesplegar funciones.

## 6. Cron de recordatorios (abono 12 h, 24 h antes, etc.)

Invocar cada 15 minutos:

```
GET/POST https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/genesis-cron?secret=GENESIS_CRON_SECRET
```

Podés usar un cron de GitHub Actions, pg_cron + pg_net, o el scheduler de Supabase.

## Qué hace Génesis hoy

- Crea lead + cliente al primer mensaje
- Califica, agenda, reagenda, cancela
- Crea abono de $20.000 con vencimiento a 12 h
- Escala a humano (el dashboard puede **Tomar conversación**)
- Deja rastro en `genesis_actions`

Pagos reales (Flow / Mercado Pago / Webpay) y plantillas HSM son el siguiente paso, cuando tengas el link o la pasarela.
