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
| `WAZEND_SESSION` | Nombre de la sesión WORKING, ej. `S0001`. Si el nombre viejo ya no existe (Wazend responde `Session "S0260" does not exist`), Génesis intenta usar la sesión WORKING que liste la API; igual conviene actualizar este secreto. |
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

## 4. Probar

1. Escribí al WhatsApp de Armonivet desde otro celular.
2. En el admin → **WhatsApp** tiene que aparecer el chat.
3. Génesis responde por Wazend al mismo número.

Si Génesis no responde, en el hilo aparece un recuadro **Sistema** con el motivo (OpenAI sin créditos, Génesis apagada, Wazend no envía).

Para hablar vos: **Admin → WhatsApp → elegí el chat → escribí abajo y Enviar**. Eso pausa a Génesis y manda el texto por Wazend. No sirve escribir desde el celular vinculado a Wazend (eso no entra al panel).

Si no responde: revisá que `OPENAI_API_KEY` tenga créditos y que la sesión Wazend esté `WORKING`. El envío humano desde el admin usa la misma función `whatsapp-send`.

Si el recuadro **Sistema** dice `Session "…" does not exist`, Génesis sí redactó: Wazend no tiene esa sesión. En el panel de Wazend:

1. Confirmá que la sesión esté **WORKING** (QR vinculado).
2. Copiá el nombre actual (ej. `S0001`, no `S0260` si ya no existe).
3. Creá una **API Key de esa sesión** (las keys son por sesión).
4. En Supabase → Edge Functions → Secrets actualizá `WAZEND_SESSION` y `WAZEND_API_KEY`.
5. En la sesión, el webhook tiene que apuntar a `…/functions/v1/whatsapp-webhook` con evento `message`.
6. En Admin → Génesis IA también podés guardar el nombre de sesión.

No sirve escribir desde el celular vinculado a Wazend.
