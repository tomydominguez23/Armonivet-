const GRAPH = "https://graph.facebook.com/v21.0";

function env(name: string) {
  return String(Deno.env.get(name) || "").trim();
}

function wazendBase() {
  return env("WAZEND_BASE_URL").replace(/\/+$/, "");
}

function wazendConfigured() {
  return Boolean(wazendBase() && env("WAZEND_API_KEY"));
}

export function toWazendChatId(phone: string) {
  const digits = String(phone || "").replace(/\D/g, "");
  const suffix = env("WAZEND_CHAT_SUFFIX") || "@c.us";
  const cleanSuffix = suffix.startsWith("@") ? suffix : `@${suffix}`;
  return `${digits}${cleanSuffix}`;
}

export function phoneFromChatId(raw: string) {
  const value = String(raw || "");
  const beforeAt = value.includes("@") ? value.split("@")[0] : value;
  return beforeAt.replace(/\D/g, "");
}

async function hmacHex(algo: "SHA-256" | "SHA-512", secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyMetaSignature(rawBody: string, header: string | null, secret: string) {
  if (!secret) return true;
  if (!header?.startsWith("sha256=")) return false;
  const expected = header.slice(7);
  const hex = await hmacHex("SHA-256", secret, rawBody);
  return timingSafeEqual(hex, expected);
}

export async function verifyWazendHmac(rawBody: string, header: string | null, secret: string) {
  if (!secret) return true;
  if (!header) return false;
  const hex = await hmacHex("SHA-512", secret, rawBody);
  const given = header.trim().toLowerCase().replace(/^sha512=/, "");
  return timingSafeEqual(hex, given);
}

export function extractInbound(payload: Record<string, unknown>) {
  const messages: Array<{
    from: string;
    name: string;
    id: string;
    type: string;
    text: string;
  }> = [];
  messages.push(...extractWazendInbound(payload));
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

function wazendEvents(payload: Record<string, unknown>) {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown>>;
  if (Array.isArray(payload.events)) return payload.events as Array<Record<string, unknown>>;
  return [payload];
}

export function extractWazendInbound(payload: Record<string, unknown>) {
  const messages: Array<{
    from: string;
    name: string;
    id: string;
    type: string;
    text: string;
  }> = [];
  for (const event of wazendEvents(payload)) {
    const name = String(event.event || "");
    if (name && name !== "message" && name !== "message.any") continue;
    const inner = (event.payload && typeof event.payload === "object"
      ? event.payload
      : event) as Record<string, unknown>;
    if (inner.fromMe === true) continue;
    const fromRaw = String(inner.from || inner.chatId || "");
    if (!fromRaw || fromRaw.includes("@g.us") || fromRaw.includes("@broadcast") || fromRaw.includes("@newsletter")) {
      continue;
    }
    const phone = phoneFromChatId(fromRaw);
    if (!phone) continue;
    const body = String(inner.body || inner.caption || inner.text || "").trim();
    const hasMedia = Boolean(inner.hasMedia);
    const type = hasMedia ? "media" : "text";
    const text = body || (hasMedia ? "[archivo]" : "");
    if (!text) continue;
    const pushName = String(
      (inner._data as { notifyName?: string } | undefined)?.notifyName ||
        (event.me as { pushName?: string } | undefined)?.pushName ||
        "",
    );
    messages.push({
      from: phone,
      name: pushName,
      id: String(inner.id || event.id || ""),
      type,
      text,
    });
  }
  return messages;
}

async function sendViaWazend(to: string, body: string) {
  const base = wazendBase();
  const key = env("WAZEND_API_KEY");
  const session = env("WAZEND_SESSION") || "default";
  const chatId = to.includes("@") ? to : toWazendChatId(to);
  const res = await fetch(`${base}/api/sendText`, {
    method: "POST",
    headers: {
      "X-Api-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session,
      chatId,
      text: body.slice(0, 4096),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      skipped: false,
      error: data.message || data.error || res.statusText,
      provider: "wazend",
      data,
    };
  }
  return { ok: true, skipped: false, id: data.id || data.key?.id || null, provider: "wazend", data };
}

async function sendViaMeta(to: string, body: string) {
  const token = env("WHATSAPP_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
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
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body: body.slice(0, 4096) },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, skipped: false, error: data.error?.message || res.statusText, provider: "meta", data };
  return { ok: true, skipped: false, id: data.messages?.[0]?.id || null, provider: "meta", data };
}

export async function sendWhatsAppText(to: string, body: string) {
  if (wazendConfigured()) return sendViaWazend(to, body);
  return sendViaMeta(to, body);
}
