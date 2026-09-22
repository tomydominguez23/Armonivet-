import { json, serviceClient, text } from "../_shared/supabase.ts";
import { extractInbound, verifyMetaSignature } from "../_shared/whatsapp.ts";
import { runGenesisTurn, upsertInbound } from "../_shared/agent.ts";

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
      return text("forbidden", 403);
    }

    if (req.method !== "POST") return json({ error: "method" }, 405);

    const raw = await req.text();
    const secret = Deno.env.get("WHATSAPP_APP_SECRET") || "";
    const signature = req.headers.get("x-hub-signature-256");
    if (secret && !(await verifyMetaSignature(raw, signature, secret))) {
      return json({ error: "invalid signature" }, 401);
    }

    const payload = JSON.parse(raw || "{}");
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
    return json({ ok: true, processed });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
