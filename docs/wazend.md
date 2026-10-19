# Vincular Génesis con Wazend

Génesis no habla directo con el celular. El flujo es:

```
WhatsApp (número de Armonivet)
        │
     Wazend
        │  webhook POST
        ▼
Supabase  whatsapp-webhook  →  Génesis (OpenAI)
        │
        ▼
Wazend  POST /api/sendText  →  WhatsApp
```

## 1. Secretos en Supabase

Dashboard → **Project Settings → Edge Functions → Secrets**:

| Secret | Qué es |
|---|---|
| `WAZEND_BASE_URL` | URL del servidor, sin barra final. Ej. `https://eu-central-1.wazend.net` (la ves en el panel de Wazend). |
| `WAZEND_API_KEY` | API Key del panel (header `X-Api-Key`). |
| `WAZEND_SESSION` | Nombre de la sesión, ej. `S0001`. |
| `WAZEND_WEBHOOK_HMAC` | Opcional. Misma clave HMAC que pongas en el webhook de Wazend. |
| `OPENAI_API_KEY` | Ya tiene que estar para que Génesis redacte. |

No pongas la API Key en GitHub Pages ni en `.env` de Vite.

Si también existen `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` (Cloud API de Meta), **Wazend gana**: si hay `WAZEND_API_KEY` + `WAZEND_BASE_URL`, se usa Wazend.

## 2. Desplegar funciones

En GitHub → **Actions → Deploy Edge Functions → Run workflow** (hace falta el secret `SUPABASE_ACCESS_TOKEN`).

## 3. Webhook en Wazend

En el panel de la sesión (o `PUT /api/sessions/{session}`):

- **URL:**
  ```
  https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/whatsapp-webhook
  ```
- **Eventos:** `message`
- **HMAC (opcional):** la misma frase que `WAZEND_WEBHOOK_HMAC`

La sesión tiene que estar en estado **WORKING** (WhatsApp vinculado con QR).

## 4. Si escribís y no aparece en el admin

El backend ya recibe webhooks. Si el chat no sale, Wazend **no está pegándole** a esa URL (o escribiste desde el mismo celular vinculado).

1. En la sesión, webhook URL exacta:
   `https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/whatsapp-webhook`
2. Eventos: `message` (y si existe, también `message.any`).
3. Dejá HMAC vacío al principio.
4. Escribí desde **otro** celular **al número que vinculaste**. No sirve escribir desde el mismo WhatsApp vinculado (eso es `fromMe` y Génesis lo ignora).
5. Recargá admin → WhatsApp.

## 5. Probar

1. Escribí al WhatsApp de Armonivet desde otro celular.
2. En el admin → **WhatsApp** tiene que aparecer el chat.
3. Génesis responde por Wazend al mismo número.

Si no responde: revisá que `OPENAI_API_KEY` tenga créditos y que la sesión Wazend esté `WORKING`. El envío humano desde el admin usa la misma función `whatsapp-send`.
