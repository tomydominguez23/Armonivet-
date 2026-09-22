import { json, serviceClient } from "../_shared/supabase.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";

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
    const conversationId = String(body.conversation_id || "");
    const content = String(body.content || "").trim();
    if (!conversationId || !content) return json({ error: "conversation_id y content requeridos" }, 400);

    const db = serviceClient();
    const { data: conv, error } = await db.from("wa_conversations").select("*").eq("id", conversationId).single();
    if (error || !conv) return json({ error: "conversación no encontrada" }, 404);

    const sent = await sendWhatsAppText(String(conv.wa_phone), content);
    await db.from("wa_messages").insert({
      conversation_id: conversationId,
      direction: "out",
      author: "humano",
      message_type: "text",
      content,
      payload: { send: sent },
    });
    await db
      .from("wa_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        last_outbound_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq("id", conversationId);
    return json({ ok: true, sent });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
