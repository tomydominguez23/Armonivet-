import { json, serviceClient } from "../_shared/supabase.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }
  try {
    if (req.method !== "POST") return json({ error: "method" }, 405);
    const body = await req.json();
    const conversationId = String(body.conversation_id || "");
    const action = String(body.action || "send");
    const content = String(body.content || "").trim();
    if (!conversationId) return json({ error: "conversation_id requerido" }, 400);

    const db = serviceClient();
    const { data: conv, error } = await db.from("wa_conversations").select("*").eq("id", conversationId).single();
    if (error || !conv) return json({ error: "conversación no encontrada" }, 404);

    if (action === "take" || action === "resume") {
      const assignedTo = action === "take" ? "humano" : "genesis";
      const status = action === "take" ? "pausada_humano" : "abierta";
      const { error: upErr } = await db
        .from("wa_conversations")
        .update({ assigned_to: assignedTo, status })
        .eq("id", conversationId);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, assigned_to: assignedTo, status });
    }

    if (!content) return json({ error: "content requerido" }, 400);

    const sent = await sendWhatsAppText(String(conv.wa_phone), content);
    const { error: msgErr } = await db.from("wa_messages").insert({
      conversation_id: conversationId,
      direction: "out",
      author: "humano",
      message_type: "text",
      content,
      payload: { send: sent },
    });
    if (msgErr) return json({ error: msgErr.message, sent }, 500);

    const { error: upErr } = await db
      .from("wa_conversations")
      .update({
        assigned_to: "humano",
        status: "pausada_humano",
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq("id", conversationId);
    if (upErr) return json({ error: upErr.message, sent }, 500);

    if (!sent.ok) {
      const detail = sent.skipped
        ? "Falta WAZEND_API_KEY y WAZEND_BASE_URL (o WhatsApp Cloud API) en Project Settings → Edge Functions → Secrets."
        : `WhatsApp no salió: ${sent.error || "error de Wazend"}`;
      return json({ error: detail, sent }, 502);
    }
    return json({ ok: true, sent });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
