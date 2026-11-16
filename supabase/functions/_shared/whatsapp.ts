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
  return beforeAt.split(":")[0].replace(/\D/g, "");
}

function phoneFromUserJid(raw: string) {
  const value = String(raw || "");
  if (!value || value.includes("@lid")) return "";
  const digits = phoneFromChatId(value);
  if (digits.length < 8 || digits.length > 15) return "";
  return digits;
}

export function resolveWazendSender(inner: Record<string, unknown>) {
  const fromRaw = String(inner.from || inner.chatId || "");
  const info = ((inner._data as { Info?: Record<string, unknown> } | undefined)?.Info) || {};
  const altPhone = phoneFromUserJid(String(info.SenderAlt || ""));
  const fromIsLid = fromRaw.includes("@lid");
  const phone = altPhone || (fromIsLid ? "" : phoneFromUserJid(fromRaw));
  const lid = fromIsLid ? phoneFromChatId(fromRaw) : "";
  const chatId = fromIsLid ? fromRaw : phone ? `${phone}@c.us` : fromRaw;
  return { phone: phone || lid, chatId, lid: phone && lid && phone !== lid ? lid : "" };
}

export function wazendDestination(conversation: { wa_phone?: string; metadata?: unknown } | null | undefined) {
  const metadata = conversation?.metadata;
  const chatId = metadata && typeof metadata === "object"
    ? String((metadata as { wazend_chat_id?: string }).wazend_chat_id || "")
    : "";
  if (chatId.includes("@")) return chatId;
  return String(conversation?.wa_phone || "");
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
    aliasPhone?: string;
    chatId?: string;
    session?: string;
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
    aliasPhone?: string;
    chatId?: string;
    session?: string;
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
    const sender = resolveWazendSender(inner);
    const phone = sender.phone;
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
      aliasPhone: sender.lid,
      chatId: sender.chatId,
      session: String(event.session || inner.session || ""),
      name: pushName,
      id: String(inner.id || event.id || ""),
      type,
      text,
    });
  }
  return messages;
}

export function sessionMissingError(error: string) {
  return /session .*does not exist|session not found|unknown session/i.test(String(error || ""));
}

export function pickWazendSession(
  sessions: Array<{ name?: string; status?: string }> | null | undefined,
  preferred: string,
) {
  const wanted = String(preferred || "").trim() || "default";
  const list = Array.isArray(sessions) ? sessions : [];
  const working = list.filter((item) =>
    String(item?.status || "").toUpperCase() === "WORKING" && String(item?.name || "").trim()
  );
  const match = working.find((item) => item.name === wanted);
  if (match?.name) return match.name;
  return working[0]?.name || wanted;
}

export function formatWazendSessions(sessions: Array<{ name?: string; status?: string }> | null | undefined) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list
    .map((item) => {
      const name = String(item?.name || "").trim();
      return name ? `${name}:${String(item?.status || "UNKNOWN")}` : "";
    })
    .filter(Boolean)
    .join(", ");
}

export function inboundSkipReasons(payload: Record<string, unknown>) {
  const reasons: string[] = [];
  for (const event of wazendEvents(payload)) {
    const name = String(event.event || "");
    if (name && name !== "message" && name !== "message.any") {
      reasons.push(`event:${name || "unknown"}`);
      continue;
    }
    const inner = (event.payload && typeof event.payload === "object"
      ? event.payload
      : event) as Record<string, unknown>;
    if (inner.fromMe === true) {
      reasons.push("fromMe");
      continue;
    }
    const fromRaw = String(inner.from || inner.chatId || "");
    if (!fromRaw) {
      reasons.push("sin-origen");
      continue;
    }
    if (fromRaw.includes("@g.us") || fromRaw.includes("@broadcast") || fromRaw.includes("@newsletter")) {
      reasons.push("grupo");
      continue;
    }
    const sender = resolveWazendSender(inner);
    if (!sender.phone) {
      reasons.push("sin-telefono");
      continue;
    }
    const body = String(inner.body || inner.caption || inner.text || "").trim();
    if (!body && !inner.hasMedia) reasons.push("sin-texto");
  }
  return reasons;
}

function wazendSendError(data: Record<string, unknown>, statusText: string) {
  const exception = data.exception && typeof data.exception === "object"
    ? String((data.exception as { message?: string }).message || "")
    : "";
  return exception || String(data.message || data.error || statusText || "send_failed");
}

export function normalizeWazendSessions(data: unknown) {
  const raw = (() => {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.sessions)) return record.sessions;
      if (Array.isArray(record.data)) return record.data;
      if (Array.isArray(record.result)) return record.result;
      if (record.name || record.id || record.session) return [record];
    }
    return [];
  })();
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return { name: "", status: "" };
      const row = item as Record<string, unknown>;
      return {
        name: String(row.name || row.id || row.session || "").trim(),
        status: String(row.status || row.state || "").trim(),
      };
    })
    .filter((item) => item.name);
}

export function wazendSessionCandidates(input: {
  cached?: string;
  hinted?: string;
  preferred?: string;
  listed?: Array<{ name?: string; status?: string }>;
}) {
  const listed = pickWazendSession(input.listed, input.hinted || input.preferred || "default");
  const names = [
    input.cached,
    input.hinted,
    listed,
    input.preferred,
    "default",
    "S0001",
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const value = String(name || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

async function listWazendSessions(base: string, key: string) {
  const notes: string[] = [];
  const paths = ["/api/sessions", "/api/sessions/", "/api/sessions?all=true"];
  for (const path of paths) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { "X-Api-Key": key },
        signal: AbortSignal.timeout(5000),
      });
      const text = await res.text();
      notes.push(`${path} ${res.status} ${text.slice(0, 180)}`);
      const data = JSON.parse(text) as unknown;
      const sessions = normalizeWazendSessions(data);
      if (sessions.length) return { sessions, notes };
    } catch (err) {
      notes.push(`${path} ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { sessions: [] as Array<{ name: string; status: string }>, notes };
}

let cachedWazendSession = "";

async function postWazendText(base: string, key: string, session: string, chatId: string, body: string) {
  try {
    const payload: Record<string, string> = {
      chatId,
      text: body.slice(0, 4096),
    };
    if (session) payload.session = session;
    const res = await fetch(`${base}/api/sendText`, {
      method: "POST",
      headers: {
        "X-Api-Key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: res.ok, data, error: wazendSendError(data, res.statusText) };
  } catch (err) {
    return {
      ok: false,
      data: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function sendViaWazend(to: string, body: string, hinted?: string) {
  const base = wazendBase();
  const key = env("WAZEND_API_KEY");
  const preferred = env("WAZEND_SESSION") || "default";
  const chatId = to.includes("@") ? to : toWazendChatId(to);
  const listed = cachedWazendSession ? { sessions: [], notes: [] } : await listWazendSessions(base, key);
  const candidates = wazendSessionCandidates({
    cached: cachedWazendSession,
    hinted,
    preferred,
    listed: listed.sessions,
  });

  let sent = { ok: false, data: {} as Record<string, unknown>, error: "sin sesión Wazend" };
  let used = "";
  for (const session of candidates) {
    used = session;
    sent = await postWazendText(base, key, session, chatId, body);
    if (sent.ok) break;
    if (!sessionMissingError(sent.error)) break;
  }
  if (!sent.ok && sessionMissingError(sent.error)) {
    used = "";
    sent = await postWazendText(base, key, "", chatId, body);
  }

  if (!sent.ok) {
    const names = formatWazendSessions(listed.sessions);
    const tried = candidates.join(", ");
    const listHint = names
      ? `Sesiones: ${names}.`
      : `No pude listar sesiones (${listed.notes[0] || "vacío"}).`;
    return {
      ok: false,
      skipped: false,
      error: `${sent.error}. Probé ${tried || preferred}. ${listHint} En Wazend copiá el nombre WORKING, creá una API Key de ESA sesión y actualizá WAZEND_SESSION y WAZEND_API_KEY. El webhook también tiene que estar en esa sesión.`,
      provider: "wazend",
      data: sent.data,
    };
  }

  cachedWazendSession = used || cachedWazendSession || preferred;
  return { ok: true, skipped: false, id: sent.data.id || (sent.data.key as { id?: string } | undefined)?.id || null, provider: "wazend", data: sent.data };
}

export async function wazendHealth() {
  if (!wazendConfigured()) return { configured: false };
  const preferred = env("WAZEND_SESSION") || "default";
  const listed = await listWazendSessions(wazendBase(), env("WAZEND_API_KEY"));
  return {
    configured: true,
    preferred,
    sessions: formatWazendSessions(listed.sessions) || "",
    list: listed.notes.slice(0, 3),
  };
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

export async function sendWhatsAppText(to: string, body: string, opts?: { session?: string }) {
  if (wazendConfigured()) return sendViaWazend(to, body, opts?.session);
  return sendViaMeta(to, body);
}
