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

Si el recuadro **Sistema** dice `Session "…" does not exist`, el número de WhatsApp está bien y Génesis sí redactó: falla el envío porque `WAZEND_SESSION` apunta a una sesión que ya no existe (pasa al volver a escanear el QR). En el panel de Wazend copiá el nombre actual (ej. `S0001`) y actualizá el secreto en Supabase.

## Por qué se desconecta y cómo evitarlo

La API key de Wazend no tiene fecha de vencimiento publicada (ni en los términos, ni en precios, ni en la documentación). Lo que sí corta el servicio:

1. **El plan de Wazend.** Se cobra por adelantado, mensual, por número conectado. Si es una prueba gratuita o el pago no entra, Wazend puede suspender la instancia sin aviso y, si se cancela, borrarla "tras un plazo razonable". Al recrearla cambia el nombre de la sesión (pasó con `S0260` → `S0249`) y se pierde el webhook. Revisá la columna **Eliminación** en *Tus números*: si muestra una fecha, la instancia se va a borrar ese día. Mantené el pago al día en el portal.
2. **La regla de 14 días de WhatsApp.** Wazend es un "dispositivo vinculado". WhatsApp lo desconecta si el **celular de Armonivet no se usa por más de 14 días** (apagado, sin internet o sin abrir WhatsApp). Abrí WhatsApp en ese celular al menos una vez por semana.
3. **Re-escanear el QR o cerrar sesión** en Wazend borra la autenticación (la configuración se mantiene, pero si se crea una sesión nueva hay que repetir todo).

### Si cambia la sesión (checklist)

1. Supabase → Edge Functions → Secrets: `WAZEND_SESSION` (y `WAZEND_BASE_URL` si cambió el servidor, sin `/` final). La API key solo si generaste una nueva.
2. Wazend → ⚙️ de la sesión → **Webhooks**: URL `https://xcnxqhjthrdvjtqezzct.supabase.co/functions/v1/whatsapp-webhook`, evento `message` (no `message.any`), HMAC vacío salvo que exista `WAZEND_WEBHOOK_HMAC`.
3. Confirmar que la sesión esté `WORKING` y mostrando el número.
4. Probar con un "Hola" desde otro celular.
