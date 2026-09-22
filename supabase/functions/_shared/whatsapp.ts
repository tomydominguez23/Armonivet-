const GRAPH = "https://graph.facebook.com/v21.0";

export async function verifyMetaSignature(rawBody: string, header: string | null, secret: string) {
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice(7);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export function extractInbound(payload: Record<string, unknown>) {
  const messages: Array<{
    from: string;
    name: string;
    id: string;
    type: string;
    text: string;
  }> = [];
  const entry = Array.isArray(payload.entry) ? payload.entry : [];
  for (const item of entry) {
    const changes = Array.isArray((item as { changes?: unknown }).changes)
      ? (item as { changes: Array<{ value?: Record<string, unknown> }> }).changes
      : [];
    for (const change of changes) {
      const value = change.value || {};
      const contacts = Array.isArray(value.contacts) ? value.contacts as Array<{ profile?: { name?: string }; wa_id?: string }> : [];
      const inbound = Array.isArray(value.messages) ? value.messages as Array<Record<string, unknown>> : [];
      for (const msg of inbound) {
        const from = String(msg.from || contacts[0]?.wa_id || "");
        const name = contacts[0]?.profile?.name || "";
        const type = String(msg.type || "text");
        let text = "";
        if (type === "text") text = String((msg.text as { body?: string } | undefined)?.body || "");
        else if (type === "button") text = String((msg.button as { text?: string } | undefined)?.text || "");
        else if (type === "interactive") {
          const interactive = msg.interactive as { button_reply?: { title?: string }; list_reply?: { title?: string } } | undefined;
          text = interactive?.button_reply?.title || interactive?.list_reply?.title || "";
        } else text = `[${type}]`;
        messages.push({ from, name, id: String(msg.id || ""), type, text });
      }
    }
  }
  return messages;
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN") || "";
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "";
  if (!token || !phoneId) {
    return { ok: false, skipped: true, error: "WhatsApp no configurado" };
  }
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: body.slice(0, 4096) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, skipped: false, error: data.error?.message || res.statusText, data };
  return { ok: true, skipped: false, id: data.messages?.[0]?.id || null, data };
}
