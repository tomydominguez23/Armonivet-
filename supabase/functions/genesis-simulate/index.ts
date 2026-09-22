import { json, serviceClient } from "../_shared/supabase.ts";
import { runGenesisTurn, upsertInbound } from "../_shared/agent.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json();
    const phone = String(body.phone || "").trim();
    const text = String(body.text || "").trim();
    const name = String(body.name || "Simulado");
    if (!phone || !text) return json({ error: "phone y text requeridos" }, 400);

    const db = serviceClient();
    const up = await upsertInbound(db, { phone, name, text });
    const turn = await runGenesisTurn(db, up.conversationId, { deliver: false });
    return json({ ok: true, conversation_id: up.conversationId, turn });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
