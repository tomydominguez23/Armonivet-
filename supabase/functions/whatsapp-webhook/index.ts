import { json, serviceClient, text } from "../_shared/supabase.ts";
import { extractInbound, verifyMetaSignature, verifyWazendHmac } from "../_shared/whatsapp.ts";
import { runGenesisTurn, upsertInbound } from "../_shared/agent.ts";

function isWazendPayload(payload: Record<string, unknown>) {
  if (typeof payload.event === "string") return true;
  if (payload.payload && typeof payload.payload === "object") return true;
  if (payload.session && payload.engine) return true;
  return Array.isArray(payload) && payload.some((item) => item && typeof item === "object" && "event" in (item as object));
}

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge") || "";
      if (mode === "subscribe" && token && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
        return text(challenge, 200);
      }
      return json({ ok: true, provider: "wazend" });
    }

    if (req.method !== "POST") return json({ error: "method" }, 405);

    const raw = await req.text();
    const parsed = JSON.parse(raw || "{}") as unknown;
    const payload = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    const wazend = isWazendPayload(payload);

    if (wazend) {
      const hmacSecret = Deno.env.get("WAZEND_WEBHOOK_HMAC") || "";
      const hmacHeader = req.headers.get("x-webhook-hmac");
      if (hmacSecret && !(await verifyWazendHmac(raw, hmacHeader, hmacSecret))) {
        return json({ error: "invalid wazend signature" }, 401);
      }
    } else {
      const secret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
      const signature = req.headers.get("x-hub-signature-256");
      if (secret && !(await verifyMetaSignature(raw, signature, secret))) {
        return json({ error: "invalid signature" }, 401);
      }
    }

    const inbound = extractInbound(payload);
    if (!inbound.length) return json({ ok: true, empty: true });

    const db = serviceClient();
    const processed = [];
    for (const msg of inbound) {
      const up = await upsertInbound(db, {
        phone: msg.from,
        name: msg.name,
        text: msg.text,
        waMessageId: msg.id,
        type: msg.type,
      });
      if (!up.duplicate) {
        try {
          processed.push(await runGenesisTurn(db, up.conversationId));
        } catch (err) {
          processed.push({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
    return json({ ok: true, processed, provider: wazend ? "wazend" : "meta" });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
